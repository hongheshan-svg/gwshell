use parking_lot::Mutex;
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SERIAL_INPUT_BUFFER_LIMIT: usize = 1024 * 1024;
const SERIAL_CMD_QUEUE_LIMIT: usize = 64;
const SERIAL_WRITE_CHUNK_SIZE: usize = 16 * 1024;
const SERIAL_WRITE_BUDGET_TIME: Duration = Duration::from_millis(8);
const SERIAL_CMD_DRAIN_LIMIT: usize = 256;

enum SerialCmd {
    WakeInput,
    Close,
}

#[derive(Default)]
struct SerialInputBuffer {
    bytes: VecDeque<u8>,
}

impl SerialInputBuffer {
    fn push(&mut self, data: &[u8]) -> Result<(), String> {
        if self.bytes.len().saturating_add(data.len()) > SERIAL_INPUT_BUFFER_LIMIT {
            return Err("Serial input buffer full".to_string());
        }
        self.bytes.extend(data);
        Ok(())
    }

    fn pop_chunk(&mut self, max_len: usize) -> Vec<u8> {
        let n = self.bytes.len().min(max_len);
        self.bytes.drain(..n).collect()
    }
}

#[derive(Clone)]
struct SerialHandle {
    tx: mpsc::SyncSender<SerialCmd>,
    input: Arc<Mutex<SerialInputBuffer>>,
    wake_pending: Arc<AtomicBool>,
    owner_thread: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
}

pub struct SerialManager {
    sessions: Mutex<HashMap<String, SerialHandle>>,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn open(
        &self,
        session_id: &str,
        port_name: &str,
        baud_rate: u32,
        data_bits: &str,
        stop_bits: &str,
        parity: &str,
        encoding: Option<&str>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // Make open idempotent. Without this, a second open() for the same
        // session_id would overwrite the map entry and orphan the previous
        // reader thread — which still holds a clone of the old port and an
        // out-of-map stop_flag that close_serial can never flip, leaking the
        // thread and keeping the OS serial port locked.
        self.close_serial_wait(session_id);

        let db = match data_bits {
            "5" => DataBits::Five,
            "6" => DataBits::Six,
            "7" => DataBits::Seven,
            _ => DataBits::Eight,
        };
        let sb = match stop_bits {
            "2" => StopBits::Two,
            _ => StopBits::One,
        };
        let par = match parity {
            p if p.contains("Odd") => Parity::Odd,
            p if p.contains("Even") => Parity::Even,
            _ => Parity::None,
        };

        let port = serialport::new(port_name, baud_rate)
            .data_bits(db)
            .stop_bits(sb)
            .parity(par)
            .flow_control(FlowControl::None)
            // Read timeout doubles as the stop-flag poll interval. 150ms keeps
            // shutdown prompt while cutting idle wakeups from ~100/s to ~7/s;
            // reads still return the instant bytes arrive, so RX latency is
            // unaffected.
            .timeout(Duration::from_millis(150))
            .open()
            .map_err(|e| format!("Failed to open serial port {}: {}", port_name, e))?;

        let mut reader = port
            .try_clone()
            .map_err(|e| format!("Failed to clone serial port: {}", e))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();

        // Resolve the encoding name once before spawning the reader thread.
        // Unknown/empty names fall back to UTF-8, matching the pty.rs pattern.
        let resolved_encoding = encoding_rs::Encoding::for_label(
            encoding.unwrap_or("").as_bytes(),
        )
        .unwrap_or(encoding_rs::UTF_8);

        let sid = session_id.to_string();
        let reader_thread = std::thread::spawn(move || {
            // Streaming decoder so a multi-byte character split across two reads
            // is not corrupted into replacement characters.
            let mut decoder = resolved_encoding.new_decoder();
            let data_ev = format!("serial-data-{}", sid);
            let exit_ev = format!("serial-exit-{}", sid);
            let mut buf = [0u8; 4096];
            loop {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_handle.emit(&exit_ev, ());
                        break;
                    }
                    Ok(n) => {
                        let mut out = String::with_capacity(n + 16);
                        let _ = decoder.decode_to_string(&buf[..n], &mut out, false);
                        if !out.is_empty() {
                            let _ = app_handle.emit(&data_ev, out);
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // Short timeout, keep polling
                    }
                    Err(_) => {
                        if !stop_clone.load(Ordering::Relaxed) {
                            let _ = app_handle.emit(&exit_ev, ());
                        }
                        break;
                    }
                }
            }
        });

        let input_buffer = Arc::new(Mutex::new(SerialInputBuffer::default()));
        let owner_input = input_buffer.clone();
        let wake_pending = Arc::new(AtomicBool::new(false));
        let owner_wake_pending = wake_pending.clone();
        let (tx, rx) = mpsc::sync_channel::<SerialCmd>(SERIAL_CMD_QUEUE_LIMIT);

        let owner_thread = std::thread::spawn(move || {
            let mut writer = port;
            let mut reader_thread = Some(reader_thread);
            let mut write_buf: Vec<u8> = Vec::new();
            let mut write_off = 0usize;
            let mut close_requested = false;

            while !close_requested {
                for _ in 0..SERIAL_CMD_DRAIN_LIMIT {
                    match rx.try_recv() {
                        Ok(SerialCmd::WakeInput) => {
                            owner_wake_pending.store(false, Ordering::Release);
                        }
                        Ok(SerialCmd::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                            close_requested = true;
                            break;
                        }
                        Err(mpsc::TryRecvError::Empty) => break,
                    }
                }

                let mut wrote_bytes = 0usize;
                let write_started = Instant::now();
                while wrote_bytes < SERIAL_WRITE_CHUNK_SIZE
                    && write_started.elapsed() < SERIAL_WRITE_BUDGET_TIME
                    && !close_requested
                {
                    if write_off >= write_buf.len() {
                        write_buf = owner_input.lock().pop_chunk(SERIAL_WRITE_CHUNK_SIZE);
                        write_off = 0;
                        if write_buf.is_empty() {
                            break;
                        }
                    }

                    match writer.write(&write_buf[write_off..]) {
                        Ok(0) => break,
                        Ok(n) => {
                            write_off += n;
                            wrote_bytes += n;
                        }
                        Err(_) => {
                            close_requested = true;
                            break;
                        }
                    }
                }
                if write_off >= write_buf.len() {
                    write_buf.clear();
                    write_off = 0;
                }
                if wrote_bytes > 0 {
                    let _ = writer.flush();
                }

                if !close_requested && write_buf.is_empty() && owner_input.lock().bytes.is_empty() {
                    match rx.recv_timeout(Duration::from_millis(8)) {
                        Ok(SerialCmd::WakeInput) => {
                            owner_wake_pending.store(false, Ordering::Release);
                        }
                        Ok(SerialCmd::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                            close_requested = true;
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
            }

            stop_flag.store(true, Ordering::Relaxed);
            if let Some(h) = reader_thread.take() {
                let _ = h.join();
            }
        });

        self.sessions.lock().insert(
            session_id.to_string(),
            SerialHandle {
                tx,
                input: input_buffer,
                wake_pending,
                owner_thread: Arc::new(Mutex::new(Some(owner_thread))),
            },
        );

        Ok(())
    }

    pub fn write_to_serial(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let handle = self.sessions.lock().get(session_id).cloned();
        let Some(handle) = handle else {
            return Err("Session not found".to_string());
        };

        handle.input.lock().push(data)?;
        if !handle.wake_pending.swap(true, Ordering::AcqRel) {
            if handle.tx.try_send(SerialCmd::WakeInput).is_err() {
                handle.wake_pending.store(false, Ordering::Release);
            }
        }
        Ok(())
    }

    pub fn close_serial(&self, session_id: &str) {
        if let Some(handle) = self.sessions.lock().remove(session_id) {
            let _ = handle.tx.try_send(SerialCmd::Close);
        }
    }

    fn close_serial_wait(&self, session_id: &str) {
        if let Some(handle) = self.sessions.lock().remove(session_id) {
            let _ = handle.tx.try_send(SerialCmd::Close);
            if let Some(thread) = handle.owner_thread.lock().take() {
                let _ = thread.join();
            }
        }
    }

    pub fn close_all(&self) {
        let handles: Vec<_> = self.sessions.lock().drain().map(|(_, v)| v).collect();
        for handle in handles {
            let _ = handle.tx.try_send(SerialCmd::Close);
        }
    }
}

pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.port_name)
        .collect()
}
