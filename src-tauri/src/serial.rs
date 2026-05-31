use parking_lot::Mutex;
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct SerialInstance {
    writer: Box<dyn serialport::SerialPort>,
    stop_flag: Arc<AtomicBool>,
    // Joined on close so the reader releases its cloned port handle before a
    // subsequent open() of the same port runs.
    reader_thread: Option<std::thread::JoinHandle<()>>,
}

pub struct SerialManager {
    instances: Mutex<HashMap<String, Arc<Mutex<SerialInstance>>>>,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
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
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // Make open idempotent. Without this, a second open() for the same
        // session_id would overwrite the map entry and orphan the previous
        // reader thread — which still holds a clone of the old port and an
        // out-of-map stop_flag that close_serial can never flip, leaking the
        // thread and keeping the OS serial port locked.
        self.close_serial(session_id);

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

        let sid = session_id.to_string();
        let reader_thread = std::thread::spawn(move || {
            // Streaming decoder so a multi-byte character split across two reads
            // is not corrupted into replacement characters.
            let mut decoder = encoding_rs::UTF_8.new_decoder();
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

        let instance = Arc::new(Mutex::new(SerialInstance {
            writer: port,
            stop_flag,
            reader_thread: Some(reader_thread),
        }));

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);

        Ok(())
    }

    pub fn write_to_serial(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        // Clone the Arc under a brief map lock, then write off the global lock.
        let instance = self.instances.lock().get(session_id).cloned();
        if let Some(instance) = instance {
            let mut inst = instance.lock();
            inst.writer
                .write_all(data)
                .map_err(|e| format!("Write failed: {}", e))?;
            let _ = inst.writer.flush();
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn close_serial(&self, session_id: &str) {
        // Remove from the map first, then signal + join the reader OFF the map
        // lock so the join (up to one read timeout) doesn't stall other ops.
        let instance = self.instances.lock().remove(session_id);
        if let Some(instance) = instance {
            let handle = {
                let mut inst = instance.lock();
                inst.stop_flag.store(true, Ordering::Relaxed);
                inst.reader_thread.take()
            };
            if let Some(h) = handle {
                let _ = h.join();
            }
        }
    }

    pub fn close_all(&self) {
        let instances: Vec<_> = self.instances.lock().drain().map(|(_, v)| v).collect();
        // Signal every reader to stop first, then join — their read timeouts
        // elapse concurrently instead of serially.
        let mut handles = Vec::new();
        for instance in &instances {
            let mut inst = instance.lock();
            inst.stop_flag.store(true, Ordering::Relaxed);
            if let Some(h) = inst.reader_thread.take() {
                handles.push(h);
            }
        }
        for h in handles {
            let _ = h.join();
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
