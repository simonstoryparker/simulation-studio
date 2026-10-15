use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Joystick {
    pub name: String,
    pub xbox: bool,
    pub axes: Vec<f64>,
    pub buttons: Vec<bool>,
    pub povs: Vec<i32>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlSnapshot {
    pub version: u8,
    pub sequence: u64,
    pub enabled: bool,
    pub estop: bool,
    pub mode: String,
    pub alliance: String,
    pub match_time: f64,
    pub joysticks: Vec<Joystick>,
}
impl Default for ControlSnapshot {
    fn default() -> Self {
        Self {
            version: 1,
            sequence: 0,
            enabled: false,
            estop: false,
            mode: "teleop".into(),
            alliance: "Unknown".into(),
            match_time: -1.,
            joysticks: vec![Joystick::default(); 6],
        }
    }
}
/// The caller supplies monotonic elapsed time, keeping phase boundaries deterministic in tests.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct MatchDurations {
    pub auto: f64,
    pub transition: f64,
    pub teleop: f64,
}
impl MatchDurations {
    pub fn validate(self) -> Result<(), String> {
        if ![self.auto, self.transition, self.teleop]
            .iter()
            .all(|v| v.is_finite() && (0.0..=3600.0).contains(v))
        {
            return Err("Invalid match durations".into());
        }
        Ok(())
    }
    pub fn progress(self, elapsed: f64) -> MatchProgress {
        let elapsed = elapsed.max(0.0);
        let total = self.auto + self.transition + self.teleop;
        let (phase, mode, enabled, remaining) = if elapsed < self.auto {
            ("auto", "auto", true, self.auto - elapsed)
        } else if elapsed < self.auto + self.transition {
            ("transition", "auto", false, 0.0)
        } else if elapsed < total {
            ("teleop", "teleop", true, total - elapsed)
        } else {
            ("complete", "teleop", false, 0.0)
        };
        MatchProgress {
            phase,
            mode,
            enabled,
            remaining,
            elapsed: elapsed.min(total),
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct MatchProgress {
    pub phase: &'static str,
    pub mode: &'static str,
    pub enabled: bool,
    pub remaining: f64,
    pub elapsed: f64,
}
#[derive(Default)]
pub struct ControlClock {
    started: Option<std::time::Instant>,
    durations: Option<MatchDurations>,
    elapsed: f64,
    phase: &'static str,
    full_match: bool,
}
impl ControlClock {
    pub fn start(&mut self, now: std::time::Instant, durations: Option<MatchDurations>) {
        self.started = Some(now);
        self.durations = durations;
        self.full_match = durations.is_some();
        self.elapsed = 0.;
        self.phase = if durations.is_some() {
            "auto"
        } else {
            "manual"
        };
    }
    pub fn cancel(&mut self, now: std::time::Instant) {
        self.advance(now);
        self.started = None;
        self.durations = None;
        self.phase = "idle";
        self.full_match = false;
    }
    pub fn advance(&mut self, now: std::time::Instant) -> Option<MatchProgress> {
        if let Some(started) = self.started {
            self.elapsed = now.saturating_duration_since(started).as_secs_f64();
            if let Some(durations) = self.durations {
                let progress = durations.progress(self.elapsed);
                self.elapsed = progress.elapsed;
                self.phase = progress.phase;
                if progress.phase == "complete" {
                    self.started = None;
                    self.durations = None;
                }
                return Some(progress);
            }
        }
        None
    }
    pub fn snapshot(&self, control: &ControlSnapshot) -> Value {
        json!({"phase":if self.phase.is_empty() {"idle"} else {self.phase}, "mode":control.mode,
            "enabled":control.enabled,"matchTime":control.match_time,"elapsed":self.elapsed,"fullMatch":self.full_match})
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct AxisMapping {
    pub input: String,
    pub negative: String,
    pub positive: String,
    pub invert: bool,
    pub deadband: f64,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct ButtonMapping {
    pub input: String,
    pub key: String,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct PortProfile {
    pub source: String,
    pub name: String,
    pub axes: Vec<AxisMapping>,
    pub buttons: Vec<ButtonMapping>,
    pub pov: Vec<String>,
}
impl Default for PortProfile {
    fn default() -> Self {
        let axes = [
            "LeftStickX",
            "LeftStickY",
            "LeftZ",
            "RightZ",
            "RightStickX",
            "RightStickY",
        ];
        let keys = [
            ("KeyA", "KeyD"),
            ("KeyS", "KeyW"),
            ("", "KeyQ"),
            ("", "KeyE"),
            ("ArrowLeft", "ArrowRight"),
            ("ArrowDown", "ArrowUp"),
        ];
        let buttons = [
            "South",
            "East",
            "West",
            "North",
            "LeftTrigger",
            "RightTrigger",
            "Select",
            "Start",
            "LeftThumb",
            "RightThumb",
        ];
        Self {
            source: "none".into(),
            name: "Controller".into(),
            axes: axes
                .iter()
                .zip(keys)
                .map(|(input, (negative, positive))| AxisMapping {
                    input: (*input).into(),
                    negative: negative.into(),
                    positive: positive.into(),
                    invert: matches!(*input, "LeftStickY" | "RightStickY"),
                    deadband: 0.05,
                })
                .collect(),
            buttons: buttons
                .iter()
                .zip([
                    "Space",
                    "KeyX",
                    "KeyC",
                    "KeyV",
                    "KeyR",
                    "KeyF",
                    "Backspace",
                    "Enter",
                    "KeyZ",
                    "KeyB",
                ])
                .map(|(input, key)| ButtonMapping {
                    input: (*input).into(),
                    key: key.into(),
                })
                .collect(),
            pov: ["KeyI", "KeyL", "KeyK", "KeyJ"].map(String::from).to_vec(),
        }
    }
}
impl PortProfile {
    pub fn validate(&self) -> Result<(), String> {
        if !(self.source == "none"
            || self.source == "keyboard"
            || self.source.starts_with("gamepad:"))
            || self.axes.len() > 12
            || self.buttons.len() > 32
            || self.pov.len() != 4
            || self.name.len() > 128
            || self.source.len() > 256
        {
            return Err("Invalid input profile".into());
        }
        if self
            .axes
            .iter()
            .any(|a| !a.deadband.is_finite() || !(0.0..1.0).contains(&a.deadband))
        {
            return Err("Deadband must be >= 0 and < 1".into());
        }
        Ok(())
    }
    pub fn sample(
        &self,
        axes: &HashMap<String, f64>,
        buttons: &HashSet<String>,
        keys: &HashSet<String>,
    ) -> Joystick {
        let mapped_axes = self
            .axes
            .iter()
            .map(|a| {
                let negative = keys.contains(&a.negative);
                let positive = keys.contains(&a.positive);
                let key_v = f64::from(u8::from(positive)) - f64::from(u8::from(negative));
                let mut v = if negative || positive {
                    key_v
                } else if self.source == "keyboard" {
                    f64::from(u8::from(keys.contains(&a.positive)))
                        - f64::from(u8::from(keys.contains(&a.negative)))
                } else {
                    *axes.get(&a.input).unwrap_or(&0.)
                };
                // Xbox triggers are 0..1; native triggers already use this range.
                if a.invert {
                    v = -v;
                }
                if v.abs() <= a.deadband {
                    0.
                } else {
                    v.signum() * ((v.abs() - a.deadband) / (1. - a.deadband)).clamp(0., 1.)
                }
            })
            .collect();
        let mapped_buttons = self
            .buttons
            .iter()
            .map(|b| buttons.contains(&b.input) || keys.contains(&b.key))
            .collect();
        let keyboard_pov = self.pov.iter().any(|key| keys.contains(key));
        let active = |i: usize, native: &str| {
            if keyboard_pov {
                keys.contains(&self.pov[i])
            } else {
                buttons.contains(native)
            }
        };
        let x = i32::from(active(1, "DPadRight")) - i32::from(active(3, "DPadLeft"));
        let y = i32::from(active(2, "DPadDown")) - i32::from(active(0, "DPadUp"));
        let pov = match (x, y) {
            (0, -1) => 0,
            (1, -1) => 45,
            (1, 0) => 90,
            (1, 1) => 135,
            (0, 1) => 180,
            (-1, 1) => 225,
            (-1, 0) => 270,
            (-1, -1) => 315,
            _ => -1,
        };
        Joystick {
            name: self.name.clone(),
            xbox: true,
            axes: mapped_axes,
            buttons: mapped_buttons,
            povs: vec![pov],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TopicDescriptor {
    pub id: i32,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub properties: Value,
}
#[derive(Default)]
pub struct Telemetry {
    pub topics: HashMap<i32, TopicDescriptor>,
    pub values: HashMap<i32, (i64, Value)>,
    pub dirty: HashSet<i32>,
    pub local: HashSet<i32>,
    pub lifecycle: Vec<Value>,
    pub resync: bool,
}
impl Telemetry {
    pub fn lifecycle(&mut self, event: Value) {
        if self.lifecycle.len() < 4096 && !self.resync {
            self.lifecycle.push(event);
        } else {
            self.lifecycle.clear();
            self.resync = true;
        }
    }
    pub fn update(&mut self, id: i32, timestamp: i64, value: Value) {
        if !self.topics.contains_key(&id) {
            return;
        }
        if self
            .values
            .get(&id)
            .is_some_and(|(old, _)| *old > timestamp)
        {
            return;
        }
        self.local.remove(&id);
        self.values.insert(id, (timestamp, value));
        self.dirty.insert(id);
    }
    pub fn drain(&mut self) -> Value {
        let lifecycle = if self.resync {
            self.resync = false;
            vec![json!({"method":"reset","topics":self.topics.values().collect::<Vec<_>>()})]
        } else {
            std::mem::take(&mut self.lifecycle)
        };
        let updates: Vec<_> = self.dirty.drain().filter_map(|id|self.values.get(&id).map(|(timestamp,v)| json!({"id":id,"timestamp":timestamp,"value":preview(v),"origin":if self.local.contains(&id){"published"}else{"received"}}))).collect();
        json!({"lifecycle":lifecycle,"values":updates})
    }
}
pub fn preview(value: &Value) -> Value {
    fn limited(value: &Value, budget: &mut usize, truncated: &mut bool) -> Value {
        match value {
            Value::String(s) => {
                let allowed = (*budget / 6).min(s.len()); // JSON escaping uses up to six bytes per character.
                let end = (0..=allowed)
                    .rev()
                    .find(|n| s.is_char_boundary(*n))
                    .unwrap_or(0);
                *truncated |= end < s.len();
                *budget = budget.saturating_sub(end * 6 + 2);
                json!(&s[..end])
            }
            Value::Array(items) => {
                let mut result = Vec::new();
                *budget = budget.saturating_sub(2);
                for item in items.iter().take(100) {
                    if *budget < 24 {
                        *truncated = true;
                        break;
                    }
                    result.push(limited(item, budget, truncated));
                    *budget = budget.saturating_sub(1);
                }
                *truncated |= result.len() < items.len();
                Value::Array(result)
            }
            _ => {
                *budget = budget.saturating_sub(value.to_string().len());
                value.clone()
            }
        }
    }
    let mut budget = 4096;
    let mut truncated = false;
    let data = limited(value, &mut budget, &mut truncated);
    let length = match value {
        Value::Array(v) => Some(v.len()),
        Value::String(s) => Some(s.len()),
        _ => None,
    };
    json!({"data":data,"truncated":truncated,"length":length})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keyboard_and_deadband() {
        let p = PortProfile {
            source: "keyboard".into(),
            ..PortProfile::default()
        };
        let keys = HashSet::from(["KeyW".into(), "Space".into(), "KeyL".into()]);
        let stick = p.sample(&HashMap::new(), &HashSet::new(), &keys);
        assert_eq!(stick.axes[1], -1.);
        assert!(stick.buttons[0]);
        assert_eq!(stick.povs[0], 90);
    }
    #[test]
    fn keyboard_merges_and_release_restores_physical_input() {
        let p = PortProfile {
            source: "gamepad:test".into(),
            ..PortProfile::default()
        };
        let axes = HashMap::from([("LeftStickX".into(), 0.5), ("RightZ".into(), 0.3)]);
        let buttons = HashSet::from(["East".into(), "DPadDown".into()]);
        let keys = HashSet::from([
            "KeyA".into(),
            "KeyD".into(),
            "Space".into(),
            "KeyI".into(),
            "KeyE".into(),
        ]);
        let stick = p.sample(&axes, &buttons, &keys);
        assert_eq!(stick.axes[0], 0.); // Opposing keys override a nonzero physical axis.
        assert_eq!(stick.axes[3], 1.); // One key controls the 0..1 trigger.
        assert!(stick.buttons[0] && stick.buttons[1]);
        assert_eq!(stick.povs[0], 0); // Keyboard D-pad takes precedence.
        let released = p.sample(&axes, &buttons, &HashSet::new());
        assert!(released.axes[0] > 0.);
        assert_eq!(released.povs[0], 180);
        let opposing_pov = p.sample(
            &axes,
            &buttons,
            &HashSet::from(["KeyI".into(), "KeyK".into()]),
        );
        assert_eq!(opposing_pov.povs[0], -1);
    }
    #[test]
    fn match_phase_boundaries_and_delayed_ticks() {
        let d = MatchDurations {
            auto: 20.,
            transition: 3.,
            teleop: 140.,
        };
        assert!(d.validate().is_ok());
        assert_eq!(d.progress(0.).remaining, 20.);
        assert_eq!(d.progress(19.99).phase, "auto");
        assert_eq!(d.progress(20.).phase, "transition");
        assert!(!d.progress(22.99).enabled);
        assert_eq!(d.progress(23.).remaining, 140.);
        assert_eq!(d.progress(25.).remaining, 138.);
        assert_eq!(d.progress(163.).phase, "complete");
        assert!(!d.progress(200.).enabled);
        assert_eq!(d.progress(200.).elapsed, 163.);
        let zero = MatchDurations {
            auto: 0.,
            transition: 0.,
            teleop: 0.,
        };
        assert_eq!(zero.progress(0.).phase, "complete");
        assert!(MatchDurations {
            auto: f64::NAN,
            ..d
        }
        .validate()
        .is_err());
        assert!(MatchDurations { teleop: -1., ..d }.validate().is_err());
    }
    #[test]
    fn injected_clock_cancellation_completion_and_restart() {
        use std::time::{Duration, Instant};
        let now = Instant::now();
        let d = MatchDurations {
            auto: 20.,
            transition: 3.,
            teleop: 140.,
        };
        let mut clock = ControlClock::default();
        clock.start(now, Some(d));
        assert_eq!(
            clock.advance(now + Duration::from_secs(23)).unwrap().phase,
            "teleop"
        );
        clock.cancel(now + Duration::from_secs(24));
        assert!(clock.advance(now + Duration::from_secs(100)).is_none());
        clock.start(now + Duration::from_secs(100), Some(d));
        assert_eq!(
            clock
                .advance(now + Duration::from_secs(101))
                .unwrap()
                .remaining,
            19.
        );
        assert_eq!(
            clock.advance(now + Duration::from_secs(300)).unwrap().phase,
            "complete"
        );
        assert!(clock.advance(now + Duration::from_secs(301)).is_none());
        clock.start(now + Duration::from_secs(400), None);
        assert!(clock.advance(now + Duration::from_secs(404)).is_none());
        assert_eq!(clock.snapshot(&ControlSnapshot::default())["elapsed"], 4.);
        clock.cancel(now + Duration::from_secs(405));
        clock.advance(now + Duration::from_secs(410));
        assert_eq!(clock.snapshot(&ControlSnapshot::default())["elapsed"], 5.);
    }
    #[test]
    fn bounded_previews() {
        assert_eq!(
            preview(&json!((0..1000).collect::<Vec<_>>()))["data"]
                .as_array()
                .unwrap()
                .len(),
            100
        );
        assert!(
            preview(&json!("é".repeat(4000)))["data"]
                .as_str()
                .unwrap()
                .len()
                <= 4096
        );
    }
    #[test]
    fn latest_only_and_order() {
        let mut t = Telemetry::default();
        t.topics.insert(
            1,
            TopicDescriptor {
                id: 1,
                name: "/x".into(),
                kind: "int".into(),
                properties: json!({}),
            },
        );
        for i in 0..10000 {
            t.update(1, i, json!(i.to_string()));
        }
        t.update(1, 0, json!("old"));
        assert_eq!(t.dirty.len(), 1);
        assert_eq!(t.drain()["values"][0]["value"]["data"], "9999");
    }
}

#[cfg(test)]
mod load_tests {
    use super::*;
    #[test]
    fn ten_thousand_topics_and_five_hundred_values_remain_bounded() {
        let mut t = Telemetry::default();
        for id in 0..10000 {
            t.topics.insert(
                id,
                TopicDescriptor {
                    id,
                    name: format!("/Stress/{id}"),
                    kind: "double".into(),
                    properties: json!({}),
                },
            );
        }
        let start = std::time::Instant::now();
        for tick in 0..300 {
            for id in 0..500 {
                t.update(id, tick, json!(id as f64 + tick as f64));
            }
            assert_eq!(t.dirty.len(), 500);
            if tick % 2 == 0 {
                let batch = t.drain();
                assert_eq!(batch["values"].as_array().unwrap().len(), 500);
            }
        }
        assert_eq!(t.values.len(), 500);
        println!(
            "300 coalescing cycles with 10k topics/500 values: {:.1}ms",
            start.elapsed().as_secs_f64() * 1000.
        );
        for id in 0..500 {
            t.values.remove(&id);
            t.dirty.remove(&id);
        }
        assert!(t.values.is_empty());
    }
    #[test]
    fn string_array_preview_has_one_shared_byte_budget() {
        let preview = preview(&json!(vec!["x".repeat(4096); 100]));
        assert!(preview["data"].to_string().len() <= 4096);
        assert_eq!(preview["truncated"], true);
    }
    #[test]
    fn lifecycle_overflow_reconciles_the_entire_catalog() {
        let mut t = Telemetry::default();
        for id in 0..10000 {
            let d = TopicDescriptor {
                id,
                name: format!("/Stress/{id}"),
                kind: "double".into(),
                properties: json!({}),
            };
            t.topics.insert(id, d.clone());
            t.lifecycle(json!({"method":"announce","topic":d}));
        }
        assert!(t.lifecycle.len() <= 4096);
        assert_eq!(
            t.drain()["lifecycle"][0]["topics"]
                .as_array()
                .unwrap()
                .len(),
            10000
        );
    }
}
