use crate::Service;
use crate::{model::*, AppState};
use futures_util::{SinkExt, StreamExt};
use rmpv::Value as Mp;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

pub struct Write {
    pub topic: String,
    pub value: Value,
    pub reply: oneshot::Sender<Result<(), String>>,
}
fn control(method: &str, params: Value) -> Message {
    Message::Text(
        json!([{"method":method,"params":params}])
            .to_string()
            .into(),
    )
}
pub fn type_id(kind: &str) -> u8 {
    match kind {
        "boolean" => 0,
        "double" => 1,
        "int" => 2,
        "float" => 3,
        "string" | "json" => 4,
        "boolean[]" => 16,
        "double[]" => 17,
        "int[]" => 18,
        "float[]" => 19,
        "string[]" => 20,
        _ => 5,
    }
}
pub fn encode(kind: &str, value: &Value) -> Result<Mp, String> {
    if let Some(scalar) = kind.strip_suffix("[]") {
        return value
            .as_array()
            .ok_or("Expected an array")?
            .iter()
            .map(|v| encode(scalar, v))
            .collect::<Result<Vec<_>, _>>()
            .map(Mp::Array);
    }
    match kind {
        "boolean" => value
            .as_bool()
            .map(Mp::Boolean)
            .ok_or("Expected boolean".into()),
        "int" => value
            .as_str()
            .ok_or("Integer must be a decimal string")?
            .parse::<i64>()
            .map(Mp::from)
            .map_err(|_| "Integer outside signed 64-bit range".into()),
        "double" | "float" => {
            let n = value.as_f64().ok_or("Expected a finite number")?;
            if !n.is_finite() || (kind == "float" && !(n as f32).is_finite()) {
                return Err("Expected finite number".into());
            }
            Ok(if kind == "float" {
                Mp::F32(n as f32)
            } else {
                Mp::F64(n)
            })
        }
        "string" | "json" => value
            .as_str()
            .map(|s| Mp::from(s.to_owned()))
            .ok_or("Expected string".into()),
        _ => Err("This topic format is read-only".into()),
    }
}
pub fn decode(v: &Mp, kind: &str) -> Value {
    match v {
        Mp::Integer(i) if kind == "int" || kind == "int[]" => json!(i.to_string()),
        Mp::Integer(i) => json!(i.as_i64()),
        Mp::Boolean(b) => json!(b),
        Mp::F32(n) => json!(n),
        Mp::F64(n) => json!(n),
        Mp::String(s) => json!(s.as_str()),
        Mp::Array(a) => Value::Array(a.iter().map(|v| decode(v, kind)).collect()),
        Mp::Binary(b) => json!(b),
        _ => Value::Null,
    }
}
fn binary(id: i32, time: i64, kind: u8, value: Mp) -> Message {
    let mut out = vec![];
    rmpv::encode::write_value(
        &mut out,
        &Mp::Array(vec![Mp::from(id), Mp::from(time), Mp::from(kind), value]),
    )
    .expect("encode NT value");
    Message::Binary(out.into())
}

pub async fn run(state: Arc<AppState>, mut writes: mpsc::Receiver<Write>) {
    loop {
        while let Ok(w) = writes.try_recv() {
            let _ = w.reply.send(Err("NetworkTables disconnected".into()));
        }
        if state.lifecycle.lock().unwrap().installing {
            tokio::time::sleep(Duration::from_millis(500)).await;
            continue;
        }
        let endpoint = state.endpoints.read().unwrap().nt.clone();
        let mut request = match endpoint.clone().into_client_request() {
            Ok(r) => r,
            Err(e) => {
                state.error("nt", &e.to_string());
                return;
            }
        };
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            "v4.1.networktables.first.wpi.edu, networktables.first.wpi.edu"
                .parse()
                .unwrap(),
        );
        if let Ok((mut socket, response)) = connect_async(request).await {
            let v41 = response
                .headers()
                .get("Sec-WebSocket-Protocol")
                .is_some_and(|v| v == "v4.1.networktables.first.wpi.edu");
            let accepted = {
                let _gate = state.mutation.lock().unwrap();
                state.lifecycle.lock().unwrap().accept(Service::Nt)
            };
            if !accepted {
                let _ = socket.close(None).await;
                continue;
            }
            let _ = state
                .app
                .emit("connection", json!({"service":"nt","connected":true}));
            let start = Instant::now();
            let mut offset: Option<i64> = None;
            let mut best_rtt = i64::MAX;
            let mut publishers: HashMap<String, i32> = HashMap::new();
            let mut next_publisher = 1;
            let mut local_values: HashMap<String, (i64, Value)> = HashMap::new();
            let mut selected: HashSet<String> = HashSet::new();
            let mut type_topics: HashSet<String> = HashSet::new();
            let mut tick = tokio::time::interval(Duration::from_millis(200));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut pong = Instant::now();
            if socket
                .send(control(
                    "subscribe",
                    json!({"subuid":1,"topics":[""],"options":{"prefix":true,"topicsonly":true}}),
                ))
                .await
                .is_err()
            {
                state.lifecycle.lock().unwrap().disconnect(Service::Nt);
                let _ = state
                    .app
                    .emit("connection", json!({"service":"nt","connected":false}));
                continue;
            }
            loop {
                tokio::select! {
                    command=writes.recv()=>{
                        let Some(w)=command else {return;};
                        let topic={let t=state.telemetry.lock().unwrap();let existing=t.topics.values().find(|d|d.name==w.topic).cloned();
                            existing.or_else(||{let root=w.topic.strip_suffix("/selected")?;let marker=t.topics.values().find(|d|d.name==format!("{root}/.type"))?;
                                if t.values.get(&marker.id)?.1=="String Chooser" {Some(TopicDescriptor{id:-2,name:w.topic.clone(),kind:"string".into(),properties:json!({})})}else{None}
                            })};
                        let result=if let (Some(topic),Some(offset))=(topic,offset) {
                            match encode(&topic.kind,&w.value) {
                                Ok(value)=>{
                                    let new_publisher=!publishers.contains_key(&w.topic);
                                    let id=*publishers.entry(w.topic.clone()).or_insert_with(||{let id=next_publisher;next_publisher+=1;id});
                                    let publish=if new_publisher{socket.send(control("publish",json!({"name":w.topic,"type":topic.kind,"pubuid":id,"properties":{}}))).await}else{Ok(())};
                                    if publish.is_err(){Err("Connection lost".into())}else{
                                        let timestamp=start.elapsed().as_micros() as i64+offset;
                                        let result=socket.send(binary(id,timestamp,type_id(&topic.kind),value)).await.map_err(|e|e.to_string());
                                        if result.is_ok(){local_values.insert(w.topic.clone(),(timestamp,w.value.clone()));let mut t=state.telemetry.lock().unwrap();if topic.id>=0{t.update(topic.id,timestamp,w.value.clone());t.local.insert(topic.id);}}
                                        result
                                    }
                                },Err(e)=>Err(e)
                            }
                        }else{Err("Topic unavailable or clock not synchronized".into())};
                        let _=w.reply.send(result);
                    },
                    _=state.nt_wake.notified()=>{
                        let requested=state.subscriptions.lock().unwrap().clone();
                        selected=requested;
                        let names:Vec<_>=selected.union(&type_topics).cloned().collect();
                        {let mut t=state.telemetry.lock().unwrap();let keep:HashSet<_>=t.topics.iter().filter(|(_,d)|selected.contains(&d.name)||type_topics.contains(&d.name)).map(|(id,_)|*id).collect();t.values.retain(|id,_|keep.contains(id));t.local.retain(|id|keep.contains(id));local_values.retain(|name,_|selected.contains(name)||type_topics.contains(name));t.dirty.retain(|id|keep.contains(id));}
                        if socket.send(control("subscribe",json!({"subuid":2,"topics":names,"options":{"periodic":0.033,"prefix":false}}))).await.is_err(){break;}
                    },
                    _=tick.tick()=>{
                        if state.endpoints.read().unwrap().nt!=endpoint || pong.elapsed()>Duration::from_secs(3){break;}
                        let msg=if v41 && offset.is_some(){Message::Ping(vec![].into())}else{binary(-1,0,2,Mp::from(start.elapsed().as_micros() as i64))};
                        if socket.send(msg).await.is_err(){break;}
                        // Periodic clock sync even when websocket pings provide liveness.
                        if v41 && socket.send(binary(-1,0,2,Mp::from(start.elapsed().as_micros() as i64))).await.is_err(){break;}
                    },
                    message=socket.next()=>{
                        match message {
                            Some(Ok(Message::Text(text)))=>{
                                if let Ok(messages)=serde_json::from_str::<Vec<Value>>(&text) {
                                    let mut types_changed=false;
                                    for message in messages {
                                        let p=&message["params"];let mut t=state.telemetry.lock().unwrap();
                                        match message["method"].as_str() {
                                            Some("announce")=>if let (Some(id),Some(name),Some(kind))=(p["id"].as_i64(),p["name"].as_str(),p["type"].as_str()) {
                                                let d=TopicDescriptor{id:id as i32,name:name.into(),kind:kind.into(),properties:p["properties"].clone()};
                                                if name.ends_with("/.type"){types_changed|=type_topics.insert(name.into());}
                                                if t.topics.get(&d.id).is_some_and(|old|old.name!=d.name||old.kind!=d.kind){t.values.remove(&d.id);t.dirty.remove(&d.id);}
                                                t.topics.insert(d.id,d.clone());
                                                if p["pubuid"].as_i64().is_some(){if let Some((timestamp,value))=local_values.get(&d.name){t.update(d.id,*timestamp,value.clone());t.local.insert(d.id);}}
                                                t.lifecycle(json!({"method":"announce","topic":d}));
                                            },
                                            Some("unannounce")=>if let Some(id)=p["id"].as_i64(){let id=id as i32;if let Some(d)=t.topics.remove(&id){types_changed|=type_topics.remove(&d.name);publishers.remove(&d.name);}t.values.remove(&id);t.local.remove(&id);t.dirty.remove(&id);t.lifecycle(json!({"method":"unannounce","id":id}));},
                                            Some("properties")=>if let Some(name)=p["name"].as_str(){
                                                if let Some(d)=t.topics.values_mut().find(|d|d.name==name){if let Some(update)=p["update"].as_object(){if !d.properties.is_object(){d.properties=json!({});}for (key,value) in update {if value.is_null(){d.properties.as_object_mut().unwrap().remove(key);}else{d.properties[key]=value.clone();}}}let d=d.clone();t.lifecycle(json!({"method":"announce","topic":d}));}
                                            },_=>{}
                                        }
                                    }
                                    if types_changed {
                                        let names:Vec<_>=selected.union(&type_topics).cloned().collect();
                                        if socket.send(control("subscribe",json!({"subuid":2,"topics":names,"options":{"periodic":0.033}}))).await.is_err(){break;}
                                    }
                                }
                            },
                            Some(Ok(Message::Binary(data)))=>{
                                let mut cursor=Cursor::new(data.as_ref());
                                while (cursor.position() as usize)<data.len() {
                                    let Ok(Mp::Array(parts))=rmpv::decode::read_value(&mut cursor) else {break;};
                                    if parts.len()!=4{continue;}
                                    let Some(id)=parts[0].as_i64() else{continue;};let Some(time)=parts[1].as_i64() else{continue;};
                                    if id==-1 {
                                        if let Some(sent)=parts[3].as_i64(){let now=start.elapsed().as_micros() as i64;let rtt=now-sent;if rtt>=0&&rtt<best_rtt {best_rtt=rtt;offset=Some(time+rtt/2-now);}pong=Instant::now();}
                                    }else{
                                        let mut t=state.telemetry.lock().unwrap();
                                        if let Some(d)=t.topics.get(&(id as i32)){let kind=d.kind.clone();t.update(id as i32,time,decode(&parts[3],&kind));}
                                    }
                                }
                            },
                            Some(Ok(Message::Ping(v)))=>{pong=Instant::now();if socket.send(Message::Pong(v)).await.is_err(){break;}},
                            Some(Ok(Message::Pong(_)))=>pong=Instant::now(),
                            None|Some(Err(_))|Some(Ok(Message::Close(_)))=>break,_=>{}
                        }
                    }
                }
            }
            let _ = socket.close(None).await;
        }
        state.lifecycle.lock().unwrap().disconnect(Service::Nt);
        {
            let mut t = state.telemetry.lock().unwrap();
            *t = Telemetry::default();
            t.lifecycle(json!({"method":"reset","topics":[]}));
        }
        let _ = state
            .app
            .emit("connection", json!({"service":"nt","connected":false}));
        tokio::time::sleep(Duration::from_millis(500)).await;
        state.nt_wake.notify_one();
    }
}
use tauri::Emitter;
pub async fn flush(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(Duration::from_millis(34));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        let batch = {
            let mut t = state.telemetry.lock().unwrap();
            if t.dirty.is_empty() && t.lifecycle.is_empty() && !t.resync {
                continue;
            }
            t.drain()
        };
        let _ = state.app.emit("telemetry", batch);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn precision() {
        let v = encode("int", &json!("9223372036854775807")).unwrap();
        assert_eq!(decode(&v, "int"), "9223372036854775807");
        assert!(encode("int", &json!("9223372036854775808")).is_err());
    }
    #[test]
    fn arrays_and_types() {
        assert!(encode("boolean[]", &json!([true, false])).is_ok());
        assert!(encode("boolean", &json!(1)).is_err());
        assert!(encode("double", &json!("2")).is_err());
        assert!(encode("struct:Pose2d", &json!([])).is_err());
    }
}
