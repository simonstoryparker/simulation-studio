use crate::{protocol, AppState, Service};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
use tauri::Emitter;
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub fn start_input(state: Arc<AppState>) {
    std::thread::Builder::new().name("native-input".into()).spawn(move || {
        let mut gilrs = match gilrs::Gilrs::new() {Ok(g)=>g, Err(e)=>{state.error("input",&e.to_string());return;}};
        let mut device_data:HashMap<String,(HashMap<String,f64>,HashSet<String>)>=HashMap::new();
        loop {
            while let Some(event)=gilrs.next_event() {
                let gamepad=gilrs.gamepad(event.id);
                let id=format!("{}:{}",gamepad.uuid().iter().map(|b|format!("{b:02x}")).collect::<String>(), usize::from(event.id));
                let data=device_data.entry(id.clone()).or_default();
                match event.event {
                    gilrs::EventType::AxisChanged(axis,v,_)=>{data.0.insert(format!("{axis:?}"),v as f64);},
                    gilrs::EventType::ButtonPressed(button,_)=>{data.1.insert(format!("{button:?}"));},
                    gilrs::EventType::ButtonReleased(button,_)=>{data.1.remove(&format!("{button:?}"));},
                    gilrs::EventType::ButtonChanged(button,v,_)=>{
                        let axis=match button {gilrs::Button::LeftTrigger2=>Some("LeftZ"),gilrs::Button::RightTrigger2=>Some("RightZ"),_=>None};
                        if let Some(axis)=axis {data.0.insert(axis.into(),v as f64);}
                    },
                    gilrs::EventType::Disconnected=>{device_data.remove(&id);state.disconnect_inputs();},
                    _=>{}
                }
            }
            let devices:Vec<_>=gilrs.gamepads().map(|(id,g)|json!({"id":format!("{}:{}",g.uuid().iter().map(|b|format!("{b:02x}")).collect::<String>(),usize::from(id)),"name":g.name()})).collect();
            for device in &devices {device_data.entry(device["id"].as_str().unwrap().into()).or_default();}
            { let mut old=state.devices.lock().unwrap();if *old!=devices { *old=devices.clone();let _=state.app.emit("devices",&devices); } }
            {
                let _gate = state.mutation.lock().unwrap();
                let profiles=state.profiles.lock().unwrap().clone();
                let physical:Vec<_>=profiles.iter().map(|p| {
                    device_data.get(p.source.trim_start_matches("gamepad:")).filter(|_|p.source.starts_with("gamepad:")).cloned().unwrap_or_default()
                }).collect();
                *state.physical_inputs.lock().unwrap()=physical;
                let old=state.control.lock().unwrap().joysticks.clone();
                state.resample_locked();
                if old!=state.control.lock().unwrap().joysticks {state.wake.notify_one();}
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }).expect("native input thread");
}

pub async fn run(state: Arc<AppState>) {
    loop {
        if state.lifecycle.lock().unwrap().installing {
            tokio::time::sleep(Duration::from_millis(500)).await;
            continue;
        }
        let endpoint = state.endpoints.read().unwrap().control.clone();
        if let Ok((mut socket, _)) = connect_async(&endpoint).await {
            let accepted = {
                let _gate = state.mutation.lock().unwrap();
                state.lifecycle.lock().unwrap().accept(Service::Control)
            };
            if !accepted {
                let _ = socket.close(None).await;
                continue;
            }
            {
                let _gate = state.mutation.lock().unwrap();
                state.disconnect_inputs_locked();
                state.control.lock().unwrap().estop = false;
                *state.applied.lock().unwrap() = serde_json::Value::Null;
            }
            let mut compatible = false;

            let mut tick = tokio::time::interval(Duration::from_millis(20));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last_reply = std::time::Instant::now();
            let mut last_preview = serde_json::Value::Null;
            let mut last_ui = std::time::Instant::now() - Duration::from_secs(1);
            loop {
                tokio::select! {
                    _=state.wake.notified()=>{if send(&state,&mut socket,compatible).await.is_err(){break;}},
                    _=tick.tick()=>{
                        if state.endpoints.read().unwrap().control!=endpoint || last_reply.elapsed()>Duration::from_millis(500) {break;}
                        state.advance_clock();
                        if send(&state,&mut socket,compatible).await.is_err(){break;}
                    },
                    message=socket.next()=>{
                        match message {
                            Some(Ok(Message::Text(text)))=> {
                                let applied = match protocol::decode_ack(&text) {
                                    Ok(ack) => ack,
                                    Err(error) => {
                                        state.error("control", &error);
                                        state.disconnect_inputs();
                                        break;
                                    }
                                };
                                if !compatible {
                                    compatible = true;
                                    state.lifecycle.lock().unwrap().control_ready = true;
                                    let _ = state.app.emit("connection", json!({"service":"control","connected":true}));
                                }
                                last_reply=std::time::Instant::now();
                                if applied["estop"] == true {
                                    let _gate = state.mutation.lock().unwrap();
                                    state.disconnect_inputs_locked();
                                    state.control.lock().unwrap().estop = true;
                                }
                                let changed={let mut old=state.applied.lock().unwrap();let changed=old["enabled"]!=applied["enabled"] || old["estop"]!=applied["estop"] || old["mode"]!=applied["mode"];*old=applied.clone();changed};
                                let joysticks=serde_json::to_value(&state.control.lock().unwrap().joysticks).unwrap();
                                if changed || (joysticks!=last_preview && last_ui.elapsed()>Duration::from_millis(33)) {let _=state.app.emit("applied",json!({"state":applied,"joysticks":joysticks}));last_preview=joysticks; last_ui=std::time::Instant::now();}
                            },
                            Some(Ok(Message::Ping(v)))=>{if socket.send(Message::Pong(v)).await.is_err(){break;}},
                            Some(Ok(Message::Close(frame)))=>{if let Some(f)=frame {state.error("control",&f.reason);}break;},
                            None|Some(Err(_))=>break,_=>{}
                        }
                    }
                }
            }
            let _ = socket.close(None).await;
        }
        state.lifecycle.lock().unwrap().disconnect(Service::Control);
        state.disconnect_inputs();
        let _ = state
            .app
            .emit("connection", json!({"service":"control","connected":false}));
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
async fn send(
    state: &AppState,
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    compatible: bool,
) -> Result<(), ()> {
    let frame = {
        let _gate = state.mutation.lock().unwrap();
        let mut c = state.control.lock().unwrap();
        c.sequence += 1;
        let mut frame = c.clone();
        if !compatible {
            frame.enabled = false;
        }
        frame
    };
    protocol::validate_control(&frame).map_err(|_| ())?;
    let message = Message::Text(serde_json::to_string(&frame).map_err(|_| ())?.into());
    tokio::time::timeout(Duration::from_millis(40), socket.send(message))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}
