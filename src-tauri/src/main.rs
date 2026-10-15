#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod control;
mod lifecycle;
mod model;
mod nt;
mod protocol;
mod updates;
use lifecycle::{Lifecycle, Service};
use model::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
};
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, oneshot, Notify};

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Endpoints {
    control: String,
    nt: String,
    project: String,
}
pub struct AppState {
    app: tauri::AppHandle,
    endpoints: RwLock<Endpoints>,
    control: Mutex<ControlSnapshot>,
    profiles: Mutex<Vec<PortProfile>>,
    keyboard_port: Mutex<usize>,
    physical_inputs: Mutex<Vec<PhysicalInput>>,
    mutation: Mutex<()>,
    clock: Mutex<ControlClock>,
    clock_event: Mutex<Value>,
    normal_bounds: Mutex<Option<WindowBounds>>,
    compact: AtomicBool,
    keys: Mutex<HashSet<String>>,
    devices: Mutex<Vec<Value>>,
    applied: Mutex<Value>,
    telemetry: Mutex<Telemetry>,
    subscriptions: Mutex<HashSet<String>>,
    lifecycle: Mutex<Lifecycle>,
    updates: updates::Updates,
    wake: Notify,
    nt_wake: Notify,
    writes: mpsc::Sender<nt::Write>,
    started: std::time::Instant,
    ready_ms: Mutex<Option<f64>>,
    workspace_io: Arc<Mutex<()>>,
}
type PhysicalInput = (std::collections::HashMap<String, f64>, HashSet<String>);
#[derive(Clone, Copy, Serialize)]
struct WindowBounds {
    width: f64,
    height: f64,
    x: f64,
    y: f64,
}
fn window_bounds(window: &tauri::WebviewWindow) -> Result<WindowBounds, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let position = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    Ok(WindowBounds {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
    })
}
impl AppState {
    fn error(&self, service: &str, message: &str) {
        let _ = self.app.emit(
            "service-error",
            json!({"service":service,"message":message}),
        );
    }
    // All input/control mutations take this gate before any of the small state locks.
    fn disconnect_inputs(&self) {
        let _gate = self.mutation.lock().unwrap();
        self.disconnect_inputs_locked();
    }
    fn disconnect_inputs_locked(&self) {
        self.clock.lock().unwrap().cancel(std::time::Instant::now());
        self.keys.lock().unwrap().clear();
        let mut control = self.control.lock().unwrap();
        control.enabled = false;
        control.match_time = 0.;
        for stick in &mut control.joysticks {
            stick.axes.fill(0.);
            stick.buttons.fill(false);
            stick.povs.fill(-1);
        }
        self.publish_clock(self.clock.lock().unwrap().snapshot(&control));
        self.wake.notify_one();
    }
    fn resample_locked(&self) {
        let profiles = self.profiles.lock().unwrap();
        let physical = self.physical_inputs.lock().unwrap();
        let keys = self.keys.lock().unwrap();
        let keyboard_port = *self.keyboard_port.lock().unwrap();
        let joysticks = sample_ports(&profiles, &physical, &keys, keyboard_port);
        self.control.lock().unwrap().joysticks = joysticks;
    }
    fn clear_keys(&self) {
        let _gate = self.mutation.lock().unwrap();
        self.keys.lock().unwrap().clear();
        self.resample_locked();
        self.wake.notify_one();
    }
    fn emit_clock_locked(&self) {
        let control = self.control.lock().unwrap();
        self.publish_clock(self.clock.lock().unwrap().snapshot(&control));
    }
    fn publish_clock(&self, mut snapshot: Value) {
        // UI telemetry runs at 10 Hz; control frames and phase changes retain 20 ms cadence.
        for key in ["elapsed", "matchTime"] {
            if let Some(v) = snapshot[key].as_f64() {
                snapshot[key] = json!((v * 10.).floor() / 10.);
            }
        }
        let mut old = self.clock_event.lock().unwrap();
        if *old != snapshot {
            *old = snapshot.clone();
            let _ = self.app.emit("match-state", snapshot);
        }
    }
    fn advance_clock(&self) {
        let _gate = self.mutation.lock().unwrap();
        let mut clock = self.clock.lock().unwrap();
        let mut control = self.control.lock().unwrap();
        if let Some(progress) = clock.advance(std::time::Instant::now()) {
            control.mode = progress.mode.into();
            control.enabled = progress.enabled && !control.estop;
            control.match_time = progress.remaining;
        }
        self.publish_clock(clock.snapshot(&control));
    }
}
fn sample_ports(
    profiles: &[PortProfile],
    physical: &[PhysicalInput],
    keys: &HashSet<String>,
    keyboard_port: usize,
) -> Vec<Joystick> {
    let empty = (Default::default(), HashSet::new());
    profiles
        .iter()
        .enumerate()
        .map(|(i, profile)| {
            if profile.source == "none" && i != keyboard_port {
                return Joystick::default();
            }
            let (axes, buttons) = physical.get(i).unwrap_or(&empty);
            profile.sample(
                axes,
                buttons,
                if i == keyboard_port { keys } else { &empty.1 },
            )
        })
        .collect()
}
fn validate_endpoint(endpoint: &str) -> Result<(), String> {
    let url = url::Url::parse(endpoint).map_err(|e| e.to_string())?;
    if url.scheme() != "ws"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only loopback simulation WebSocket endpoints are allowed".into());
    }
    Ok(())
}
fn arguments(args: &[String]) -> Endpoints {
    let value = |flag: &str, default: &str| {
        args.windows(2)
            .find(|v| v[0] == flag)
            .map(|v| v[1].clone())
            .unwrap_or_else(|| default.into())
    };
    Endpoints {
        control: value("--control", "ws://127.0.0.1:5811"),
        nt: value("--nt", "ws://127.0.0.1:5810/nt/simulation-studio"),
        project: value("--project", "robot"),
    }
}
#[tauri::command]
fn bootstrap(state: tauri::State<'_, Arc<AppState>>) -> Value {
    let _gate = state.mutation.lock().unwrap();
    let t = state.telemetry.lock().unwrap();
    let (control_connected, nt_connected) = {
        let gate = state.lifecycle.lock().unwrap();
        (gate.control_ready, gate.connected(Service::Nt))
    };
    json!({"endpoints":state.endpoints.read().unwrap().clone(),"controlConnected":control_connected,"ntConnected":nt_connected,"topics":t.topics.values().collect::<Vec<_>>(),"values":t.values.iter().map(|(id,(timestamp,value))|json!({"id":id,"timestamp":timestamp,"value":preview(value)})).collect::<Vec<_>>(),"devices":state.devices.lock().unwrap().clone(),"applied":state.applied.lock().unwrap().clone(),"keyboardPort":*state.keyboard_port.lock().unwrap(),"compact":state.compact.load(Ordering::Relaxed),"matchState":state.clock.lock().unwrap().snapshot(&state.control.lock().unwrap())})
}
#[tauri::command]
fn connect(endpoints: Endpoints, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    let _gate = state.mutation.lock().unwrap();
    if state.lifecycle.lock().unwrap().installing {
        return Err("Studio is installing an update".into());
    }
    validate_endpoint(&endpoints.control)?;
    validate_endpoint(&endpoints.nt)?;
    if endpoints.project.is_empty() || endpoints.project.len() > 100 {
        return Err("Invalid project identity".into());
    }
    state.disconnect_inputs_locked();
    *state.endpoints.write().unwrap() = endpoints;
    state.nt_wake.notify_one();
    Ok(())
}
#[tauri::command]
fn set_control(
    enabled: bool,
    estop: bool,
    mode: String,
    alliance: String,
    match_time: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if !["teleop", "auto", "test"].contains(&mode.as_str())
        || !["Unknown", "Red1", "Red2", "Red3", "Blue1", "Blue2", "Blue3"]
            .contains(&alliance.as_str())
        || !match_time.is_finite()
        || !(-1.0..=3600.0).contains(&match_time)
    {
        return Err("Invalid DS options".into());
    }
    let _gate = state.mutation.lock().unwrap();
    if enabled {
        can_enable(&state)?;
    }
    let now = std::time::Instant::now();
    let old = state.control.lock().unwrap().clone();
    let changed = old.mode != mode || old.alliance != alliance;
    let mut clock = state.clock.lock().unwrap();
    if !enabled || estop || changed {
        clock.cancel(now);
    }
    if enabled && !estop && (!old.enabled || changed) {
        clock.start(now, None);
    }
    drop(clock);
    let mut c = state.control.lock().unwrap();
    c.estop |= estop;
    c.enabled = enabled && !c.estop;
    c.mode = mode;
    c.alliance = alliance;
    c.match_time = if enabled { match_time } else { 0. };
    drop(c);
    state.emit_clock_locked();
    state.wake.notify_one();
    Ok(())
}
fn can_enable(state: &AppState) -> Result<(), String> {
    if !state.lifecycle.lock().unwrap().control_ready {
        return Err("Simulation control disconnected".into());
    }
    if !state
        .app
        .get_webview_window("main")
        .is_some_and(|w| w.is_focused().unwrap_or(false))
    {
        return Err("Focus this window before enabling".into());
    }
    if state.control.lock().unwrap().estop || state.applied.lock().unwrap()["estop"] == true {
        return Err("E-stop is latched until the simulation restarts".into());
    }
    Ok(())
}
#[tauri::command]
fn set_keys(keys: Vec<String>, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if keys.len() > 128 || keys.iter().any(|s| s.is_empty() || s.len() > 32) {
        return Err("Invalid keys".into());
    }
    let _gate = state.mutation.lock().unwrap();
    // Ignore delayed key events after the window has lost focus.
    let focused = state
        .app
        .get_webview_window("main")
        .is_some_and(|w| w.is_focused().unwrap_or(false));
    *state.keys.lock().unwrap() = if focused {
        keys.into_iter().collect()
    } else {
        HashSet::new()
    };
    state.resample_locked();
    state.wake.notify_one();
    Ok(())
}
#[tauri::command]
fn set_keyboard_port(port: usize, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if port >= 6 {
        return Err("Keyboard port must be between 0 and 5".into());
    }
    let _gate = state.mutation.lock().unwrap();
    state.keys.lock().unwrap().clear();
    *state.keyboard_port.lock().unwrap() = port;
    state.resample_locked();
    let _ = state.app.emit("keyboard-port", port);
    state.wake.notify_one();
    Ok(())
}
#[tauri::command]
fn start_match(
    auto: f64,
    transition: f64,
    teleop: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let durations = MatchDurations {
        auto,
        transition,
        teleop,
    };
    durations.validate()?;
    let _gate = state.mutation.lock().unwrap();
    can_enable(&state)?;
    let now = std::time::Instant::now();
    state.clock.lock().unwrap().start(now, Some(durations));
    let progress = durations.progress(0.);
    let mut c = state.control.lock().unwrap();
    c.enabled = progress.enabled;
    c.mode = progress.mode.into();
    c.match_time = progress.remaining;
    drop(c);
    state.emit_clock_locked();
    state.wake.notify_one();
    Ok(())
}
#[tauri::command]
fn set_compact(
    compact: bool,
    width: Option<f64>,
    height: Option<f64>,
    x: Option<f64>,
    y: Option<f64>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<WindowBounds>, String> {
    let window = state
        .app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    let previous = state.compact.load(Ordering::Relaxed);
    if previous == compact {
        return Ok(None);
    }
    if compact {
        let bounds = window_bounds(&window)?;
        *state.normal_bounds.lock().unwrap() = Some(bounds);
        state.compact.store(true, Ordering::Relaxed);
        window
            .set_min_size(Some(tauri::LogicalSize::new(260., 140.)))
            .map_err(|e| e.to_string())?;
        window.set_decorations(false).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        let width = width
            .filter(|v| v.is_finite())
            .unwrap_or(320.)
            .clamp(260., 4000.);
        let height = height
            .filter(|v| v.is_finite())
            .unwrap_or(180.)
            .clamp(140., 4000.);
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        if let (Some(x), Some(y)) = (x.filter(|v| v.is_finite()), y.filter(|v| v.is_finite())) {
            window
                .set_position(tauri::LogicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
        Ok(None)
    } else {
        let overlay = window_bounds(&window)?;
        state.compact.store(false, Ordering::Relaxed);
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_decorations(true).map_err(|e| e.to_string())?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(900., 600.)))
            .map_err(|e| e.to_string())?;
        if let Some(bounds) = state.normal_bounds.lock().unwrap().take() {
            window
                .set_size(tauri::LogicalSize::new(bounds.width, bounds.height))
                .map_err(|e| e.to_string())?;
            window
                .set_position(tauri::LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|e| e.to_string())?;
        }
        Ok(Some(overlay))
    }
}
#[tauri::command]
fn resize_compact(
    width: f64,
    height: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if !state.compact.load(Ordering::Relaxed) || !width.is_finite() || !height.is_finite() {
        return Err("Invalid compact size".into());
    }
    state
        .app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?
        .set_size(tauri::LogicalSize::new(
            width.clamp(260., 4000.),
            height.clamp(140., 4000.),
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn set_profiles(
    profiles: Vec<PortProfile>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if profiles.len() != 6 {
        return Err("Exactly six joystick ports required".into());
    }
    let mut assigned = HashSet::new();
    for profile in &profiles {
        profile.validate()?;
        if profile.source.starts_with("gamepad:") && !assigned.insert(&profile.source) {
            return Err("A physical controller can only be assigned to one port".into());
        }
    }
    let _gate = state.mutation.lock().unwrap();
    let old = state.profiles.lock().unwrap().clone();
    let reassigned = old.iter().zip(&profiles).any(|(a, b)| a.source != b.source);
    if old != profiles {
        state.disconnect_inputs_locked();
    }
    if reassigned {
        *state.physical_inputs.lock().unwrap() = vec![(Default::default(), HashSet::new()); 6];
    }
    *state.profiles.lock().unwrap() = profiles;
    state.resample_locked();
    state.wake.notify_one();
    Ok(())
}
#[tauri::command]
fn subscribe(names: Vec<String>, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if names.len() > 20000 || names.iter().any(|n| n.len() > 4096) {
        return Err("Subscription too large".into());
    }
    *state.subscriptions.lock().unwrap() = names.into_iter().collect();
    state.nt_wake.notify_one();
    Ok(())
}
#[tauri::command]
async fn write_topic(
    topic: String,
    value: Value,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if !state.lifecycle.lock().unwrap().connected(Service::Nt) {
        return Err("NetworkTables disconnected".into());
    }
    let (reply, rx) = oneshot::channel();
    state
        .writes
        .try_send(nt::Write {
            topic,
            value,
            reply,
        })
        .map_err(|_| "Write queue busy")?;
    tokio::time::timeout(std::time::Duration::from_secs(2), rx)
        .await
        .map_err(|_| "Write timed out")?
        .map_err(|_| "Connection lost")?
}
#[tauri::command]
fn topic_details(id: i32, state: tauri::State<'_, Arc<AppState>>) -> Result<Value, String> {
    state
        .telemetry
        .lock()
        .unwrap()
        .values
        .get(&id)
        .map(|(_, v)| v.clone())
        .ok_or("Value unavailable".into())
}
fn workspace_path(state: &AppState, project: &str) -> Result<PathBuf, String> {
    if project.is_empty() || project.len() > 100 {
        return Err("Invalid project identity".into());
    }
    // Hex encode the identity, avoiding path traversal and identity collisions.
    let key = project
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let dir = state
        .app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspaces");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{key}.json")))
}
#[tauri::command]
async fn load_workspace(
    project: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<Value>, String> {
    let path = workspace_path(&state, &project)?;
    let io = state.workspace_io.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = io.lock().unwrap();
        if !path.exists() {
            return Ok(None);
        }
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
            return Err("Workspace too large".into());
        }
        let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        validate_workspace(&value)?;
        Ok(Some(value))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn validate_workspace(w: &Value) -> Result<(), String> {
    if (w["version"] != 1 && w["version"] != 2)
        || w["tabs"]
            .as_array()
            .is_none_or(|t| t.is_empty() || t.len() > 100)
        || w["profiles"].as_array().is_none_or(|p| p.len() != 6)
    {
        return Err("Unsupported or invalid workspace".into());
    }
    let profiles: Vec<PortProfile> =
        serde_json::from_value(w["profiles"].clone()).map_err(|e| e.to_string())?;
    for p in profiles {
        p.validate()?;
    }
    if w["version"] == 2
        && (w["keyboardPort"].as_u64().is_none_or(|p| p > 5)
            || w["topicsCollapsed"].as_bool().is_none()
            || w["matchDurations"].as_object().is_none()
            || w["overlay"].as_object().is_none())
    {
        return Err("Invalid workspace settings".into());
    }
    Ok(())
}
#[tauri::command]
async fn save_workspace(
    workspace: Value,
    project: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let path = workspace_path(&state, &project)?;
    let io = state.workspace_io.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = io.lock().unwrap();
        validate_workspace(&workspace)?;
        let data = serde_json::to_vec(&workspace).map_err(|e| e.to_string())?;
        if data.len() > 8 * 1024 * 1024 {
            return Err("Workspace too large".into());
        }
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, data).map_err(|e| e.to_string())?;
        std::fs::rename(temporary, path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn report_frontend_error(message: String) {
    eprintln!("Simulation Studio frontend: {message}");
}

#[tauri::command]
fn report_ready(state: tauri::State<'_, Arc<AppState>>) -> f64 {
    let mut ready = state.ready_ms.lock().unwrap();
    let ms = *ready.get_or_insert_with(|| state.started.elapsed().as_secs_f64() * 1000.);
    println!("Simulation Studio frontend ready: {ms:.1} ms");
    ms
}

fn main() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            let next = arguments(&args);
            let state = app.state::<Arc<AppState>>();
            let _gate = state.mutation.lock().unwrap();
            if state.lifecycle.lock().unwrap().installing {
                return;
            }
            if validate_endpoint(&next.control).is_ok()
                && validate_endpoint(&next.nt).is_ok()
                && !next.project.is_empty()
                && next.project.len() <= 100
            {
                if *state.endpoints.read().unwrap() != next {
                    state.disconnect_inputs_locked();
                    {
                        *state.profiles.lock().unwrap() = vec![PortProfile::default(); 6];
                        *state.physical_inputs.lock().unwrap() =
                            vec![(Default::default(), HashSet::new()); 6];
                        *state.keyboard_port.lock().unwrap() = 0;
                    }
                    *state.endpoints.write().unwrap() = next.clone();
                    let _ = app.emit("session", next);
                    state.nt_wake.notify_one();
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .setup(move |app| {
            let endpoints = updates::resume_or_arguments(app.handle())?;
            validate_endpoint(&endpoints.control)?;
            validate_endpoint(&endpoints.nt)?;
            let (writes, receiver) = mpsc::channel(64);
            let state = Arc::new(AppState {
                app: app.handle().clone(),
                endpoints: RwLock::new(endpoints),
                control: Mutex::new(ControlSnapshot::default()),
                profiles: Mutex::new(vec![PortProfile::default(); 6]),
                keyboard_port: Mutex::new(0),
                physical_inputs: Mutex::new(vec![(Default::default(), HashSet::new()); 6]),
                mutation: Mutex::new(()),
                clock: Mutex::new(ControlClock::default()),
                clock_event: Mutex::new(Value::Null),
                normal_bounds: Mutex::new(None),
                compact: AtomicBool::new(false),
                keys: Mutex::new(HashSet::new()),
                devices: Mutex::new(vec![]),
                applied: Mutex::new(Value::Null),
                telemetry: Mutex::new(Telemetry::default()),
                subscriptions: Mutex::new(HashSet::new()),
                lifecycle: Mutex::new(Lifecycle::default()),
                updates: updates::Updates::default(),
                wake: Notify::new(),
                nt_wake: Notify::new(),
                writes,
                started,
                ready_ms: Mutex::new(None),
                workspace_io: Arc::new(Mutex::new(())),
            });
            app.manage(state.clone());
            control::start_input(state.clone());
            // Dedicated control runtime so heavy NT decoding cannot starve the control timer.
            let control_state = state.clone();
            std::thread::Builder::new()
                .name("sim-control".into())
                .spawn(move || {
                    tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .unwrap()
                        .block_on(control::run(control_state))
                })?;
            tauri::async_runtime::spawn(nt::run(state.clone(), receiver));
            tauri::async_runtime::spawn(nt::flush(state.clone()));
            tauri::async_runtime::spawn(updates::periodic(state));
            Ok(())
        })
        .on_window_event(|window, event| {
            let state = window.state::<Arc<AppState>>();
            match event {
                tauri::WindowEvent::Focused(false) if state.compact.load(Ordering::Relaxed) => {
                    state.clear_keys();
                }
                tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Destroyed => {
                    state.disconnect_inputs()
                }
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
                    if state.compact.load(Ordering::Relaxed) =>
                {
                    if let Some(main) = state.app.get_webview_window("main") {
                        if let Ok(bounds) = window_bounds(&main) {
                            let _ = state.app.emit("overlay-bounds", bounds);
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            updates::update_status,
            updates::check_update,
            updates::prepare_update,
            updates::cancel_update,
            updates::install_update,
            updates::open_downloads,
            bootstrap,
            report_ready,
            report_frontend_error,
            connect,
            set_control,
            set_keys,
            set_profiles,
            set_keyboard_port,
            start_match,
            set_compact,
            resize_compact,
            subscribe,
            write_topic,
            topic_details,
            load_workspace,
            save_workspace
        ])
        .run(tauri::generate_context!())
        .expect("Simulation Studio failed");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn switching_keyboard_ports_preserves_physical_inputs() {
        let profiles = vec![
            PortProfile {
                source: "gamepad:test".into(),
                ..PortProfile::default()
            },
            PortProfile::default(),
        ];
        let physical = vec![
            (
                std::collections::HashMap::from([("LeftStickX".into(), 0.5)]),
                HashSet::from(["East".into()]),
            ),
            Default::default(),
        ];
        let before = sample_ports(&profiles, &physical, &HashSet::from(["KeyD".into()]), 0);
        assert_eq!(before[0].axes[0], 1.);
        let after = sample_ports(&profiles, &physical, &HashSet::new(), 1);
        assert!(after[0].axes[0] > 0. && after[0].axes[0] < 1.);
        assert!(after[0].buttons[1]);
        assert_eq!(after[1].axes[0], 0.);
        let operator = sample_ports(&profiles, &physical, &HashSet::from(["Space".into()]), 1);
        assert_eq!(after[0], operator[0]);
        assert!(operator[1].buttons[0]);
    }
    #[test]
    fn loopback_only() {
        assert!(validate_endpoint("ws://127.0.0.1:5811").is_ok());
        assert!(validate_endpoint("ws://10.5.81.2:5811").is_err());
        assert!(validate_endpoint("wss://localhost:5811").is_err());
    }
}
