import type {
  NtValue,
  PortProfile,
  TopicDescriptor,
  WidgetInstance,
  WidgetKind,
  Workspace,
} from "./types";
export const defaultProfile = (): PortProfile => ({
  source: "none",
  name: "Xbox / Keyboard",
  axes: [
    "LeftStickX",
    "LeftStickY",
    "LeftZ",
    "RightZ",
    "RightStickX",
    "RightStickY",
  ].map((input, i) => ({
    input,
    negative: ["KeyA", "KeyS", "", "", "ArrowLeft", "ArrowDown"][i],
    positive: ["KeyD", "KeyW", "KeyQ", "KeyE", "ArrowRight", "ArrowUp"][i],
    invert: i === 1 || i === 5,
    deadband: 0.05,
  })),
  buttons: [
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
  ].map((input, i) => ({
    input,
    key: [
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
    ][i],
  })),
  pov: ["KeyI", "KeyL", "KeyK", "KeyJ"],
});
export function emptyWorkspace(): Workspace {
  const id = crypto.randomUUID();
  return {
    version: 2,
    tabs: [{ id, name: "Workspace", widgets: [] }],
    activeTab: id,
    profiles: Array.from({ length: 6 }, (_, i) => ({
      ...defaultProfile(),
      name: i === 0 ? "Driver" : i === 1 ? "Operator" : `Port ${i}`,
    })),
    keyboardPort: 0,
    topicsCollapsed: false,
    matchDurations: { auto: 20, transition: 3, teleop: 140 },
    overlay: {
      width: 320,
      height: 180,
      x: 120,
      y: 120,
      controls: ["mode", "keyboard"],
      topics: [],
    },
  };
}
export function defaultKind(type: string): WidgetKind {
  if (type === "boolean") return "boolean";
  if (["int", "double", "float"].includes(type)) return "number";
  if (["string", "json"].includes(type)) return "string";
  if (["boolean[]", "int[]", "float[]", "double[]", "string[]"].includes(type))
    return "array";
  return "details";
}
export function createWidget(
  topic: string,
  type: string,
  widgets: WidgetInstance[],
  chooser = false,
): WidgetInstance {
  return {
    id: crypto.randomUUID(),
    topic,
    title: topic.split("/").filter(Boolean).at(-1) || topic,
    kind: chooser ? "chooser" : defaultKind(type),
    min: 0,
    max: 1,
    step: 0.01,
    options: [],
    x: 0,
    y: widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0),
    w: 4,
    h: 4,
  };
}
export function folderCandidates(
  prefix: string,
  topics: TopicDescriptor[],
  choosers: Set<string>,
  existing: WidgetInstance[],
): { name: string; type: string; chooser: boolean }[] {
  const exact = prefix === "/" ? "/" : prefix.replace(/\/$/, "") + "/";
  const bound = new Set(existing.map((w) => w.topic));
  const added = new Set<string>();
  return [...topics]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((t) => {
      if (!t.name.startsWith(exact)) return [];
      let ancestor = t.name;
      let root: string | undefined;
      while (ancestor) {
        if (choosers.has(ancestor)) {
          root = ancestor;
          break;
        }
        ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
      }
      const name = root ?? t.name;
      if (bound.has(name) || added.has(name)) return [];
      added.add(name);
      return [{ name, type: t.type, chooser: !!root }];
    });
}
export function parseValue(type: string, text: string): NtValue {
  if (type.endsWith("[]")) {
    const array: unknown = JSON.parse(text);
    if (!Array.isArray(array)) throw Error("Enter a JSON array");
    return array.map((v) => validateValue(type.slice(0, -2), v));
  }
  if (type === "string" || type === "json") return text;
  return validateValue(
    type,
    type === "int"
      ? text
      : type === "boolean"
        ? JSON.parse(text)
        : Number(text.trim() || "invalid"),
  );
}
export function validateValue(type: string, value: unknown): NtValue {
  if (type === "int") {
    if (typeof value !== "string" || !/^[-+]?\d+$/.test(value))
      throw Error("Use a decimal string for a 64-bit integer");
    const n = BigInt(value);
    if (n < -(1n << 63n) || n >= 1n << 63n)
      throw Error("Integer outside signed 64-bit range");
    return n.toString();
  }
  if (type === "boolean" && typeof value === "boolean") return value;
  if (
    ["double", "float"].includes(type) &&
    typeof value === "number" &&
    Number.isFinite(value)
  )
    return value;
  if (["string", "json"].includes(type) && typeof value === "string")
    return value;
  throw Error(`Invalid ${type} value`);
}
export function validateWorkspace(input: unknown): Workspace {
  const source = input as Omit<Workspace, "version"> & { version: number };
  if (!source || (source.version !== 1 && source.version !== 2))
    throw Error("Unsupported or invalid workspace");
  const w =
    source.version === 1
      ? {
          ...source,
          version: 2 as const,
          keyboardPort: Math.max(
            0,
            source.profiles.findIndex((p) => p.source === "keyboard"),
          ),
          profiles: source.profiles.map((p, i) => ({
            ...p,
            source: p.source === "keyboard" ? "none" : p.source,
            name:
              p.name === "Xbox / Keyboard"
                ? i === 0
                  ? "Driver"
                  : i === 1
                    ? "Operator"
                    : `Port ${i}`
                : p.name,
          })),
          topicsCollapsed: false,
          matchDurations: { auto: 20, transition: 3, teleop: 140 },
          overlay: {
            width: 320,
            height: 180,
            x: 120,
            y: 120,
            controls: ["mode", "keyboard"],
            topics: [],
          },
        }
      : source;
  if (
    !w ||
    w.version !== 2 ||
    !Array.isArray(w.tabs) ||
    !w.tabs.length ||
    w.tabs.length > 100 ||
    !Array.isArray(w.profiles) ||
    w.profiles.length !== 6
  )
    throw Error("Unsupported or invalid workspace");
  const ids = new Set<string>();
  const kinds = [
    "readout",
    "boolean",
    "number",
    "slider",
    "string",
    "array",
    "selector",
    "chooser",
    "details",
  ];
  for (const tab of w.tabs) {
    if (
      !tab ||
      typeof tab.id !== "string" ||
      typeof tab.name !== "string" ||
      !Array.isArray(tab.widgets) ||
      ids.has(tab.id)
    )
      throw Error("Invalid tab");
    ids.add(tab.id);
    for (const widget of tab.widgets) {
      if (
        !widget ||
        typeof widget.id !== "string" ||
        ids.has(widget.id) ||
        typeof widget.topic !== "string" ||
        !widget.topic ||
        typeof widget.title !== "string" ||
        !kinds.includes(widget.kind) ||
        ![
          widget.x,
          widget.y,
          widget.w,
          widget.h,
          widget.min,
          widget.max,
          widget.step,
        ].every(Number.isFinite) ||
        widget.x < 0 ||
        widget.y < 0 ||
        widget.w < 1 ||
        widget.w > 12 ||
        widget.x + widget.w > 12 ||
        widget.h < 2 ||
        !Array.isArray(widget.options)
      )
        throw Error("Invalid widget");
      ids.add(widget.id);
    }
  }
  if (!w.tabs.some((t) => t.id === w.activeTab))
    throw Error("Invalid active tab");
  for (const p of w.profiles) {
    if (
      !p ||
      typeof p.source !== "string" ||
      p.source === "keyboard" ||
      typeof p.name !== "string" ||
      !Array.isArray(p.axes) ||
      p.axes.length > 12 ||
      !Array.isArray(p.buttons) ||
      p.buttons.length > 32 ||
      !Array.isArray(p.pov) ||
      p.pov.length !== 4 ||
      !p.pov.every((v) => typeof v === "string") ||
      p.axes.some(
        (a) =>
          !a ||
          ![a.input, a.positive, a.negative].every(
            (v) => typeof v === "string",
          ) ||
          typeof a.invert !== "boolean" ||
          !Number.isFinite(a.deadband) ||
          a.deadband < 0 ||
          a.deadband >= 1,
      ) ||
      p.buttons.some(
        (b) => !b || typeof b.input !== "string" || typeof b.key !== "string",
      )
    )
      throw Error("Invalid input profile");
  }
  // Explicitly copy only configuration; imports cannot restore control state or telemetry.
  if (
    !Number.isInteger(w.keyboardPort) ||
    w.keyboardPort < 0 ||
    w.keyboardPort > 5 ||
    typeof w.topicsCollapsed !== "boolean" ||
    !w.matchDurations ||
    ![
      w.matchDurations.auto,
      w.matchDurations.transition,
      w.matchDurations.teleop,
    ].every((v) => Number.isFinite(v) && v >= 0 && v <= 3600) ||
    !w.overlay ||
    !Number.isFinite(w.overlay.width) ||
    w.overlay.width < 260 ||
    w.overlay.width > 2500 ||
    !Number.isFinite(w.overlay.height) ||
    w.overlay.height < 140 ||
    w.overlay.height > 2000 ||
    !Number.isFinite(w.overlay.x) ||
    Math.abs(w.overlay.x) > 100000 ||
    !Number.isFinite(w.overlay.y) ||
    Math.abs(w.overlay.y) > 100000 ||
    !Array.isArray(w.overlay.controls) ||
    w.overlay.controls.some(
      (v) => !["mode", "alliance", "estop", "keyboard"].includes(v),
    ) ||
    !Array.isArray(w.overlay.topics) ||
    w.overlay.topics.some((v) => typeof v !== "string" || v.length > 4096)
  )
    throw Error("Invalid workspace settings");
  // Widget write capability follows supported widget types; imported permissions are ignored.
  const tabs = w.tabs.map((tab) => ({
    ...tab,
    widgets: tab.widgets.map((widget) => {
      const clean = { ...widget };
      delete (clean as WidgetInstance & { editable?: unknown }).editable;
      return clean;
    }),
  }));
  return {
    version: 2,
    tabs,
    activeTab: w.activeTab,
    profiles: w.profiles,
    keyboardPort: w.keyboardPort,
    topicsCollapsed: w.topicsCollapsed,
    matchDurations: w.matchDurations,
    overlay: w.overlay,
  };
}
