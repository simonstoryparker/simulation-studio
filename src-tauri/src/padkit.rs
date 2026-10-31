use std::collections::{HashMap, HashSet};
#[cfg(target_os = "macos")]
use std::sync::{Arc, Mutex};

pub const DEVICE_ID: &str = "padkit:powera";
pub const DEVICE_NAME: &str = "PowerA Controller (Padkit)";
#[allow(dead_code)]
pub const PADKIT_MAGIC: u32 = 0x31415750;

pub type DeviceInputs = (HashMap<String, f64>, HashSet<String>);

#[allow(dead_code)]
pub fn normalize_axis(value: i16) -> f64 {
    if value < 0 {
        value as f64 / 32768.0
    } else {
        value as f64 / 32767.0
    }
}

#[allow(dead_code)]
pub fn parse_frame(buf: &[u8; 32]) -> Option<Option<DeviceInputs>> {
    let magic = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    let version = u32::from_le_bytes(buf[4..8].try_into().unwrap());
    let _sequence = u32::from_le_bytes(buf[8..12].try_into().unwrap());
    let connected = u32::from_le_bytes(buf[12..16].try_into().unwrap());

    if magic != PADKIT_MAGIC || version != 1 {
        return None;
    }
    if connected == 0 {
        return Some(None);
    }

    let lx = i16::from_le_bytes(buf[16..18].try_into().unwrap());
    let ly = i16::from_le_bytes(buf[18..20].try_into().unwrap());
    let rx = i16::from_le_bytes(buf[20..22].try_into().unwrap());
    let ry = i16::from_le_bytes(buf[22..24].try_into().unwrap());
    let buttons = u16::from_le_bytes(buf[24..26].try_into().unwrap());
    let lt = u16::from_le_bytes(buf[26..28].try_into().unwrap());
    let rt = u16::from_le_bytes(buf[28..30].try_into().unwrap());
    let guide = u16::from_le_bytes(buf[30..32].try_into().unwrap());

    let mut axes = HashMap::new();
    axes.insert("LeftStickX".to_string(), normalize_axis(lx));
    axes.insert("LeftStickY".to_string(), normalize_axis(ly));
    axes.insert("RightStickX".to_string(), normalize_axis(rx));
    axes.insert("RightStickY".to_string(), normalize_axis(ry));
    axes.insert("LeftZ".to_string(), (lt as f64) / 1023.0);
    axes.insert("RightZ".to_string(), (rt as f64) / 1023.0);

    let mut btns = HashSet::new();
    if buttons & 0x0010 != 0 {
        btns.insert("South".to_string());
    }
    if buttons & 0x0020 != 0 {
        btns.insert("East".to_string());
    }
    if buttons & 0x0040 != 0 {
        btns.insert("West".to_string());
    }
    if buttons & 0x0080 != 0 {
        btns.insert("North".to_string());
    }
    if buttons & 0x1000 != 0 {
        btns.insert("LeftTrigger".to_string());
    }
    if buttons & 0x2000 != 0 {
        btns.insert("RightTrigger".to_string());
    }
    if buttons & 0x0008 != 0 {
        btns.insert("Select".to_string());
    }
    if buttons & 0x0004 != 0 {
        btns.insert("Start".to_string());
    }
    if buttons & 0x4000 != 0 {
        btns.insert("LeftThumb".to_string());
    }
    if buttons & 0x8000 != 0 {
        btns.insert("RightThumb".to_string());
    }
    if buttons & 0x0100 != 0 {
        btns.insert("DPadUp".to_string());
    }
    if buttons & 0x0200 != 0 {
        btns.insert("DPadDown".to_string());
    }
    if buttons & 0x0400 != 0 {
        btns.insert("DPadLeft".to_string());
    }
    if buttons & 0x0800 != 0 {
        btns.insert("DPadRight".to_string());
    }
    if guide != 0 {
        btns.insert("Mode".to_string());
    }
    if lt > 256 {
        btns.insert("LeftTrigger2".to_string());
    }
    if rt > 256 {
        btns.insert("RightTrigger2".to_string());
    }

    Some(Some((axes, btns)))
}

#[cfg(target_os = "macos")]
fn socket_path() -> std::path::PathBuf {
    if let Ok(override_path) = std::env::var("PADKIT_SOCKET") {
        if !override_path.is_empty() {
            return std::path::PathBuf::from(override_path);
        }
    }
    if let Ok(override_path) = std::env::var("POWERA_SOCKET") {
        if !override_path.is_empty() {
            return std::path::PathBuf::from(override_path);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let mut path = std::path::PathBuf::from(home);
        path.push("Library/Application Support/PowerA Adapters/input.sock");
        path
    } else {
        std::path::PathBuf::from("/tmp/padkit.sock")
    }
}

pub struct PadkitClient {
    #[cfg(target_os = "macos")]
    latest: Arc<Mutex<Option<DeviceInputs>>>,
}

impl PadkitClient {
    #[cfg(target_os = "macos")]
    pub fn new() -> Self {
        use std::io::Read;
        use std::os::unix::net::UnixStream;
        use std::time::Duration;

        let latest = Arc::new(Mutex::new(None));
        let worker_latest = latest.clone();

        std::thread::Builder::new()
            .name("padkit-client".into())
            .spawn(move || loop {
                let path = socket_path();
                if let Ok(mut stream) = UnixStream::connect(&path) {
                    let mut buf = [0u8; 32];
                    let mut used = 0;
                    loop {
                        match stream.read(&mut buf[used..]) {
                            Ok(0) => break,
                            Ok(n) => {
                                used += n;
                                if used == 32 {
                                    used = 0;
                                    if let Some(state) = parse_frame(&buf) {
                                        *worker_latest.lock().unwrap() = state;
                                    }
                                }
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                            Err(_) => break,
                        }
                    }
                }
                *worker_latest.lock().unwrap() = None;
                std::thread::sleep(Duration::from_millis(500));
            })
            .expect("padkit client thread");

        Self { latest }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn new() -> Self {
        Self {}
    }

    pub fn snapshot(&self) -> Option<DeviceInputs> {
        #[cfg(target_os = "macos")]
        {
            self.latest.lock().unwrap().clone()
        }
        #[cfg(not(target_os = "macos"))]
        {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_frame() {
        let mut buf = [0u8; 32];
        buf[0..4].copy_from_slice(&PADKIT_MAGIC.to_le_bytes());
        buf[4..8].copy_from_slice(&1u32.to_le_bytes()); // version
        buf[8..12].copy_from_slice(&5u32.to_le_bytes()); // sequence
        buf[12..16].copy_from_slice(&1u32.to_le_bytes()); // connected
        buf[16..18].copy_from_slice(&(-32768i16).to_le_bytes()); // lx = -1.0
        buf[18..20].copy_from_slice(&(32767i16).to_le_bytes()); // ly = 1.0
        buf[20..22].copy_from_slice(&(16383i16).to_le_bytes()); // rx ~ 0.5
        buf[22..24].copy_from_slice(&(-16384i16).to_le_bytes()); // ry = -0.5
        buf[24..26].copy_from_slice(&(0x0010u16 | 0x1000u16 | 0x0100u16).to_le_bytes()); // South, LeftTrigger, DPadUp
        buf[26..28].copy_from_slice(&(1023u16).to_le_bytes()); // lt = 1.0
        buf[28..30].copy_from_slice(&(511u16).to_le_bytes()); // rt ~ 0.5
        buf[30..32].copy_from_slice(&(1u16).to_le_bytes()); // guide

        let parsed = parse_frame(&buf).expect("should parse");
        let (axes, buttons) = parsed.expect("should be connected");

        assert!((axes["LeftStickX"] - (-1.0)).abs() < 0.001);
        assert!((axes["LeftStickY"] - 1.0).abs() < 0.001);
        assert!((axes["LeftZ"] - 1.0).abs() < 0.001);
        assert!((axes["RightZ"] - (511.0 / 1023.0)).abs() < 0.001);

        assert!(buttons.contains("South"));
        assert!(!buttons.contains("East"));
        assert!(buttons.contains("LeftTrigger"));
        assert!(buttons.contains("DPadUp"));
        assert!(buttons.contains("Mode"));
        assert!(buttons.contains("LeftTrigger2"));
        assert!(buttons.contains("RightTrigger2"));
    }

    #[test]
    fn test_parse_disconnected_frame() {
        let mut buf = [0u8; 32];
        buf[0..4].copy_from_slice(&PADKIT_MAGIC.to_le_bytes());
        buf[4..8].copy_from_slice(&1u32.to_le_bytes());
        buf[12..16].copy_from_slice(&0u32.to_le_bytes()); // disconnected

        let parsed = parse_frame(&buf).expect("valid frame");
        assert!(parsed.is_none());
    }

    #[test]
    fn test_parse_invalid_magic() {
        let mut buf = [0u8; 32];
        buf[0..4].copy_from_slice(&0xdeadbeefu32.to_le_bytes());
        assert!(parse_frame(&buf).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_macos_padkit_client_socket() {
        use std::io::Write;
        use std::os::unix::net::UnixListener;

        let temp_dir = std::env::temp_dir();
        let sock_path = temp_dir.join(format!("padkit-test-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&sock_path);

        let listener = UnixListener::bind(&sock_path).expect("bind test socket");
        std::env::set_var("PADKIT_SOCKET", sock_path.to_str().unwrap());

        let client = PadkitClient::new();

        // Accept connection from background client thread
        let (mut stream, _) = listener.accept().expect("accept connection");

        // Send a frame
        let mut buf = [0u8; 32];
        buf[0..4].copy_from_slice(&PADKIT_MAGIC.to_le_bytes());
        buf[4..8].copy_from_slice(&1u32.to_le_bytes());
        buf[8..12].copy_from_slice(&10u32.to_le_bytes());
        buf[12..16].copy_from_slice(&1u32.to_le_bytes()); // connected
        buf[16..18].copy_from_slice(&(32767i16).to_le_bytes()); // lx = 1.0
        buf[24..26].copy_from_slice(&(0x0020u16).to_le_bytes()); // East
        stream.write_all(&buf).expect("write frame");

        // Wait for client to receive
        let mut received = false;
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(20));
            if let Some((axes, buttons)) = client.snapshot() {
                if (axes["LeftStickX"] - 1.0).abs() < 0.001 && buttons.contains("East") {
                    received = true;
                    break;
                }
            }
        }
        assert!(received, "client should receive and parse frame");

        // Close stream and verify disconnect
        drop(stream);
        let mut disconnected = false;
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(20));
            if client.snapshot().is_none() {
                disconnected = true;
                break;
            }
        }
        assert!(
            disconnected,
            "client should report disconnected when socket closes"
        );

        let _ = std::fs::remove_file(&sock_path);
    }
}
