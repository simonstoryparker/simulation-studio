use crate::{AppState, Endpoints};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const DOWNLOADS: &str = "https://github.com/simonstoryparker/simulation-studio/releases/latest";
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: String,
    version: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
}
#[derive(Default)]
pub struct Updates {
    status: Mutex<Status>,
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    busy: AtomicBool,
}
fn publish(state: &AppState, status: Status) {
    *state.updates.status.lock().unwrap() = status.clone();
    let _ = state.app.emit("update-status", status);
}
#[tauri::command]
pub fn update_status(state: tauri::State<'_, Arc<AppState>>) -> Status {
    state.updates.status.lock().unwrap().clone()
}
async fn check(state: Arc<AppState>) -> Result<(), String> {
    if state
        .updates
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Ok(());
    }
    let result = check_inner(&state).await;
    if let Err(error) = &result {
        let mut status = state.updates.status.lock().unwrap().clone();
        status.phase = if state.updates.pending.lock().unwrap().is_some() {
            "ready"
        } else {
            "error"
        }
        .into();
        status.message = Some(format!("{error}. You can retry or download the installer."));
        publish(&state, status);
    }
    state.updates.busy.store(false, Ordering::Release);
    result
}
async fn check_inner(state: &Arc<AppState>) -> Result<(), String> {
    if state.lifecycle.lock().unwrap().installing || state.updates.pending.lock().unwrap().is_some()
    {
        return Ok(());
    }
    let Some(key) = option_env!("STUDIO_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty())
    else {
        publish(
            state,
            Status {
                phase: "unavailable".into(),
                message: Some("Updates are disabled in this development build.".into()),
                ..Status::default()
            },
        );
        return Ok(());
    };
    publish(
        state,
        Status {
            phase: "checking".into(),
            ..Status::default()
        },
    );
    let updater = state
        .app
        .updater_builder()
        .pubkey(key)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        publish(
            state,
            Status {
                phase: "current".into(),
                ..Status::default()
            },
        );
        return Ok(());
    };
    let version = update.version.clone();
    let mut downloaded = 0;
    let mut last_progress = std::time::Instant::now() - Duration::from_secs(1);
    publish(
        state,
        Status {
            phase: "downloading".into(),
            version: Some(version.clone()),
            ..Status::default()
        },
    );
    // Tauri verifies the signature before returning the downloaded bytes.
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_progress.elapsed() >= Duration::from_millis(200) {
                    publish(
                        state,
                        Status {
                            phase: "downloading".into(),
                            version: Some(version.clone()),
                            downloaded,
                            total,
                            message: None,
                        },
                    );
                    last_progress = std::time::Instant::now();
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    *state.updates.pending.lock().unwrap() = Some((update, bytes));
    publish(
        state,
        Status {
            phase: "ready".into(),
            version: Some(version),
            downloaded,
            total: Some(downloaded),
            message: None,
        },
    );
    Ok(())
}
#[tauri::command]
pub async fn check_update(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    check(state.inner().clone()).await
}
pub async fn periodic(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_secs(6 * 60 * 60));
    loop {
        interval.tick().await;
        let _ = check(state.clone()).await;
    }
}
#[tauri::command]
pub fn prepare_update(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if state.updates.pending.lock().unwrap().is_none() {
        return Err("No downloaded update is ready".into());
    }
    let _gate = state.mutation.lock().unwrap();
    state.lifecycle.lock().unwrap().prepare()?;
    state.disconnect_inputs_locked();
    let mut status = state.updates.status.lock().unwrap().clone();
    status.phase = "preparing".into();
    publish(&state, status);
    Ok(())
}
#[tauri::command]
pub fn cancel_update(state: tauri::State<'_, Arc<AppState>>) {
    let _gate = state.mutation.lock().unwrap();
    if state.updates.status.lock().unwrap().phase != "installing" {
        state.lifecycle.lock().unwrap().installing = false;
        let mut status = state.updates.status.lock().unwrap().clone();
        status.phase = "ready".into();
        publish(&state, status);
    }
}
fn resume_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("update-session.json"))
}
pub fn resume_or_arguments(app: &tauri::AppHandle) -> Result<Endpoints, String> {
    let args: Vec<_> = std::env::args().collect();
    let path = resume_path(app)?;
    let saved = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Endpoints>(&bytes).ok());
    let _ = std::fs::remove_file(path);
    // The updater may restart with the original process arguments, which can be older
    // than the most recently forwarded session. Consume the saved latest session once.
    let endpoint = select_session(saved, &args);
    if endpoint.project.is_empty() || endpoint.project.len() > 100 {
        return Err("Invalid project identity".into());
    }
    crate::validate_endpoint(&endpoint.control)?;
    crate::validate_endpoint(&endpoint.nt)?;
    Ok(endpoint)
}
#[tauri::command]
pub async fn install_update(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    if !state.lifecycle.lock().unwrap().installing {
        return Err("Prepare the update before installing".into());
    }
    let pending = state
        .updates
        .pending
        .lock()
        .unwrap()
        .take()
        .ok_or("No update is ready")?;
    tauri::async_runtime::spawn_blocking(move || {
        let (update, bytes) = pending;
        let result = (|| -> Result<(), String> {
            let path = resume_path(&state.app)?;
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&path, serde_json::to_vec(&*state.endpoints.read().unwrap()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let mut status = state.updates.status.lock().unwrap().clone();
            status.phase = "installing".into();
            publish(&state, status);
            update.install(&bytes).map_err(|e| e.to_string())?;
            state.app.restart();
        })();
        if let Err(error) = &result {
            if let Ok(path) = resume_path(&state.app) { let _ = std::fs::remove_file(path); }
            *state.updates.pending.lock().unwrap() = Some((update, bytes));
            state.lifecycle.lock().unwrap().installing = false;
            let mut status = state.updates.status.lock().unwrap().clone();
            status.phase = "ready".into();
            status.message = Some(format!("Cannot replace Studio: {error}. Download and run the signed installer to repair the installation."));
            publish(&state, status);
        }
        result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn open_downloads() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open")
        .arg(DOWNLOADS)
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", DOWNLOADS])
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open")
        .arg(DOWNLOADS)
        .spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

fn select_session(saved: Option<Endpoints>, args: &[String]) -> Endpoints {
    saved.unwrap_or_else(|| crate::arguments(args))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_restart_restores_latest_forwarded_session_instead_of_original_args() {
        let args = vec!["studio".into(), "--project".into(), "original".into()];
        let latest = Endpoints {
            control: "ws://127.0.0.1:5811".into(),
            nt: "ws://127.0.0.1:5810/nt/simulation-studio".into(),
            project: "latest".into(),
        };
        assert_eq!(select_session(Some(latest), &args).project, "latest");
        assert_eq!(select_session(None, &args).project, "original");
        let controls = crate::model::ControlSnapshot::default();
        assert!(!controls.enabled);
        assert!(!controls.estop);
        assert!(controls
            .joysticks
            .iter()
            .all(|j| j.axes.is_empty() && j.buttons.is_empty()));
    }
}
