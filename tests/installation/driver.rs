// Included only in the generated 0.0.0 installation-test copy, never the shipping app.
pub async fn smoke(state: Arc<AppState>) {
    let result = smoke_inner(state.clone()).await;
    let output = std::env::var("STUDIO_SMOKE_RESULT").unwrap();
    std::fs::write(output, serde_json::to_vec(&serde_json::json!({"ok":result.is_ok(),"error":result.err()})).unwrap()).unwrap();
    state.app.exit(0);
}
async fn smoke_inner(state: Arc<AppState>) -> Result<(), String> {
    for _ in 0..300 {
        if state.ready_ms.lock().unwrap().is_some() { break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if state.ready_ms.lock().unwrap().is_none() { return Err("Frontend did not become ready".into()); }
    let checked = check(state.clone()).await;
    if std::env::var("STUDIO_SMOKE_MODE").unwrap() != "install" {
        if checked.is_ok() || state.updates.pending.lock().unwrap().is_some() || state.lifecycle.lock().unwrap().installing {
            return Err("Failed update was accepted or changed installation state".into());
        }
        return Ok(());
    }
    checked?;
    for service in [crate::Service::Control, crate::Service::Nt] {
        assert!(state.lifecycle.lock().unwrap().accept(service));
        if prepare_update(state.app.state()).is_ok() { return Err("Active simulation allowed installation".into()); }
        state.lifecycle.lock().unwrap().disconnect(service);
    }
    let latest: Endpoints = serde_json::from_str(&std::env::var("STUDIO_SMOKE_SESSION").unwrap()).unwrap();
    crate::connect(latest.clone(), state.app.state())?;
    let workspace = crate::load_workspace(latest.project.clone(), state.app.state()).await?.ok_or("Missing test workspace")?;
    crate::save_workspace(workspace, latest.project.clone(), state.app.state()).await?;
    state.control.lock().unwrap().enabled = true;
    state.keys.lock().unwrap().insert("Space".into());
    prepare_update(state.app.state())?;
    if state.control.lock().unwrap().enabled || !state.keys.lock().unwrap().is_empty() { return Err("Update did not clear enabled state/inputs".into()); }
    if crate::connect(latest, state.app.state()).is_ok() || state.lifecycle.lock().unwrap().accept(crate::Service::Control) {
        return Err("New session connected during installation".into());
    }
    std::fs::write(std::env::var("STUDIO_SMOKE_RESULT").unwrap(), r#"{"ok":true,"installing":true}"#).unwrap();
    install_update(state.app.state()).await
}
