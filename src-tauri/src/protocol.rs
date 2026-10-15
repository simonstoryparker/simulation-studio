use crate::model::ControlSnapshot;
use serde_json::Value;

pub fn validate_control(frame: &ControlSnapshot) -> Result<(), String> {
    if frame.version != 1
        || frame.sequence > i64::MAX as u64
        || !["teleop", "auto", "test"].contains(&frame.mode.as_str())
        || !["Unknown", "Red1", "Red2", "Red3", "Blue1", "Blue2", "Blue3"]
            .contains(&frame.alliance.as_str())
        || !frame.match_time.is_finite()
        || !(-1.0..=3600.0).contains(&frame.match_time)
        || frame.joysticks.len() != 6
    {
        return Err("Invalid version-1 control frame".into());
    }
    for stick in &frame.joysticks {
        if stick.name.encode_utf16().count() > 128
            || stick.axes.len() > 12
            || stick.buttons.len() > 32
            || stick.povs.len() > 12
            || stick.axes.iter().any(|a| !a.is_finite() || a.abs() > 1.0)
            || stick.povs.iter().any(|p| !(-1..360).contains(p))
        {
            return Err("Invalid version-1 joystick".into());
        }
    }
    Ok(())
}
pub fn decode_ack(text: &str) -> Result<Value, String> {
    let ack = serde_json::from_str(text)
        .map_err(|_| "Invalid simulation control acknowledgement JSON".to_string())?;
    validate_ack(&ack)?;
    Ok(ack)
}
pub fn validate_ack(ack: &Value) -> Result<(), String> {
    if ack["version"] != 1 {
        return Err("Incompatible simulation control protocol. Studio requires version 1; update Studio or the robot integration.".into());
    }
    if ack["sequence"].as_u64().is_none()
        || ack["enabled"].as_bool().is_none()
        || ack["estop"].as_bool().is_none()
        || ack["attached"].as_bool().is_none()
        || !["teleop", "auto", "test"].contains(&ack["mode"].as_str().unwrap_or(""))
    {
        return Err("Invalid simulation control acknowledgement".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    #[test]
    fn shared_protocol_vectors() {
        let corpus: Value =
            serde_json::from_str(include_str!("../../tests/protocol/control-v1.json")).unwrap();
        for case in corpus["control"].as_array().unwrap() {
            let result = serde_json::from_value::<ControlSnapshot>(case["frame"].clone())
                .map_err(|e| e.to_string())
                .and_then(|f| validate_control(&f));
            assert_eq!(
                result.is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
        for case in corpus["acknowledgements"].as_array().unwrap() {
            assert_eq!(
                validate_ack(&case["ack"]).is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
    // Real loopback WebSocket fixture, runnable without WPILib or private robot sources.
    #[tokio::test]
    async fn local_bridge_fixture_rejects_incompatible_ack() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
            let frame: ControlSnapshot = serde_json::from_str(&text).unwrap();
            validate_control(&frame).unwrap();
            assert!(!frame.enabled);
            socket.send(tokio_tungstenite::tungstenite::Message::Text(
                r#"{"version":2,"sequence":0,"enabled":false,"estop":false,"attached":true,"mode":"teleop"}"#.into()
            )).await.unwrap();
        });
        let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
            .await
            .unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&ControlSnapshot::default())
                    .unwrap()
                    .into(),
            ))
            .await
            .unwrap();
        let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert!(validate_ack(&serde_json::from_str(&text).unwrap()).is_err());
        server.await.unwrap();
    }
}
