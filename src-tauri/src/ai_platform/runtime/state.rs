use crate::ai_platform::infrastructure::proxy::ProxyHandle;
use parking_lot::Mutex;
use std::sync::OnceLock;

static PROXY: OnceLock<Mutex<Option<ProxyHandle>>> = OnceLock::new();

fn proxy_cell() -> &'static Mutex<Option<ProxyHandle>> {
    PROXY.get_or_init(|| Mutex::new(None))
}

pub fn is_proxy_running() -> bool {
    proxy_cell()
        .lock()
        .as_ref()
        .map(|h| h.is_running())
        .unwrap_or(false)
}

pub fn proxy_addr() -> Option<(String, u16)> {
    let guard = proxy_cell().lock();
    guard.as_ref().filter(|h| h.is_running()).map(|h| (h.host.clone(), h.port))
}

/// Store a new handle (replacing any previous stopped one).
pub fn set_proxy_handle(handle: ProxyHandle) {
    *proxy_cell().lock() = Some(handle);
}

/// Stop the running proxy and clear the handle.
pub fn stop_proxy() {
    if let Some(handle) = proxy_cell().lock().as_mut() {
        handle.stop();
    }
}
