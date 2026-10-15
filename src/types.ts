export type NtValue = boolean | number | string | NtValue[] | null;
export interface TopicDescriptor {
  id: number;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}
export interface ValuePreview {
  data: NtValue;
  truncated: boolean;
  length?: number;
}
export interface TopicValue {
  origin?: "published" | "received";
  timestamp: number;
  value: ValuePreview;
}
export interface AxisMapping {
  input: string;
  negative: string;
  positive: string;
  invert: boolean;
  deadband: number;
}
export interface ButtonMapping {
  input: string;
  key: string;
}
export interface PortProfile {
  source: string;
  name: string;
  axes: AxisMapping[];
  buttons: ButtonMapping[];
  pov: string[];
}
export type WidgetKind =
  | "readout"
  | "boolean"
  | "number"
  | "slider"
  | "string"
  | "array"
  | "selector"
  | "chooser"
  | "details";
export interface WidgetInstance {
  id: string;
  topic: string;
  title: string;
  kind: WidgetKind;
  min: number;
  max: number;
  step: number;
  options: { label: string; value: NtValue }[];
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Workspace {
  version: 2;
  tabs: { id: string; name: string; widgets: WidgetInstance[] }[];
  activeTab: string;
  profiles: PortProfile[];
  keyboardPort: number;
  topicsCollapsed: boolean;
  matchDurations: { auto: number; transition: number; teleop: number };
  overlay: {
    width: number;
    height: number;
    x: number;
    y: number;
    controls: string[];
    topics: string[];
  };
}
export interface Endpoints {
  control: string;
  nt: string;
  project: string;
}
export interface Joystick {
  name: string;
  xbox: boolean;
  axes: number[];
  buttons: boolean[];
  povs: number[];
}
export interface AppliedControlState {
  version: number;
  sequence: number;
  enabled: boolean;
  estop: boolean;
  attached: boolean;
  mode: string;
}
export interface ControlSnapshot {
  version: 1;
  sequence: number;
  enabled: boolean;
  estop: boolean;
  mode: string;
  alliance: string;
  matchTime: number;
  joysticks: Joystick[];
}
export interface Device {
  id: string;
  name: string;
}
export interface TelemetryBatch {
  lifecycle: (
    | { method: "announce"; topic: TopicDescriptor }
    | { method: "unannounce"; id: number }
    | { method: "reset"; topics: TopicDescriptor[] }
  )[];
  values: {
    origin?: "published" | "received";
    id: number;
    timestamp: number;
    value: ValuePreview;
  }[];
}
