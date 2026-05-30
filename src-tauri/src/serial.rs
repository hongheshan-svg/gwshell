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
            .timeout(Duration::from_millis(10))
            .open()
            .map_err(|e| format!("Failed to open serial port {}: {}", port_name, e))?;

        let mut reader = port
            .try_clone()
            .map_err(|e| format!("Failed to clone serial port: {}", e))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();

        let instance = Arc::new(Mutex::new(SerialInstance {
            writer: port,
            stop_flag,
        }));

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);

        let sid = session_id.to_string();
        std::thread::spawn(move || {
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

        Ok(())
    }

    pub fn write_to_serial(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let instances = self.instances.lock();
        if let Some(instance) = instances.get(session_id) {
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
        if let Some(instance) = self.instances.lock().remove(session_id) {
            let inst = instance.lock();
            inst.stop_flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn close_all(&self) {
        let instances: Vec<_> = self.instances.lock().drain().map(|(_, v)| v).collect();
        for instance in instances {
            let inst = instance.lock();
            inst.stop_flag.store(true, Ordering::Relaxed);
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
