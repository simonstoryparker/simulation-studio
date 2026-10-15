import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getTopic,
  useSubscriptions,
  useTopic,
  useDescriptor,
  useReceived,
} from "./store";
import { parseValue, validateValue } from "./workspace";
import type { NtValue, WidgetInstance, WidgetKind } from "./types";
interface WidgetProps {
  widget: WidgetInstance;
  connected: boolean;
  compact?: boolean;
}
export interface WidgetDefinition {
  label: string;
  compatible: (type: string) => boolean;
  defaults: Partial<WidgetInstance>;
  render: React.ComponentType<WidgetProps>;
  settings: React.ComponentType<{
    widget: WidgetInstance;
    onChange: (widget: WidgetInstance) => void;
  }>;
}
const scalar = (t: string) =>
  ["boolean", "int", "double", "float", "string", "json"].includes(t);
const numeric = (t: string) => ["int", "double", "float"].includes(t);
function BuiltinSettings({
  widget,
  onChange,
}: {
  widget: WidgetInstance;
  onChange: (widget: WidgetInstance) => void;
}) {
  return (
    <>
      {widget.kind === "slider" && (
        <div className="fields">
          {(["min", "max", "step"] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                type="number"
                value={widget[key]}
                onChange={(e) =>
                  onChange({ ...widget, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
      )}
      {widget.kind === "selector" && (
        <label>
          Options as JSON: label and typed value
          <textarea
            defaultValue={JSON.stringify(widget.options, null, 2)}
            onBlur={(e) => {
              try {
                const options = JSON.parse(e.target.value);
                if (
                  !Array.isArray(options) ||
                  options.some((o) => typeof o.label !== "string")
                )
                  throw Error("Invalid options");
                onChange({ ...widget, options });
              } catch {
                e.target.setCustomValidity(
                  "Enter an array of label/value objects",
                );
                e.target.reportValidity();
              }
            }}
          />
        </label>
      )}
    </>
  );
}
function BuiltinWidget({ widget: w, connected, compact }: WidgetProps) {
  const value = useTopic(w.topic),
    optionsValue = useTopic(w.topic + "/options"),
    activeValue = useTopic(w.topic + "/active"),
    defaultValue = useTopic(w.topic + "/default"),
    selectedValue = useTopic(w.topic + "/selected");
  const received = useReceived(w.topic);
  const topic = useDescriptor(w.topic),
    type = topic?.type;
  useSubscriptions(
    w.kind === "chooser"
      ? [
          w.topic + "/.type",
          w.topic + "/options",
          w.topic + "/active",
          w.topic + "/default",
          w.topic + "/selected",
        ]
      : [w.topic],
  );
  const [draft, setDraft] = useState(""),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<{
      value: NtValue;
      timestamp: number;
    } | null>(null),
    [details, setDetails] = useState<NtValue>();
  const focused = useRef(false);
  const data =
    w.kind === "chooser"
      ? (selectedValue?.value.data ??
        activeValue?.value.data ??
        defaultValue?.value.data)
      : value?.value.data;
  useEffect(() => {
    if (!focused.current)
      setDraft(Array.isArray(data) ? JSON.stringify(data) : String(data ?? ""));
  }, [data]);
  useEffect(() => {
    if (
      !pending ||
      !value ||
      value.origin === "published" ||
      value.timestamp <= pending.timestamp
    )
      return;
    setMessage(
      JSON.stringify(value.value.data) === JSON.stringify(pending.value)
        ? "Received updated value"
        : "Server published a different value",
    );
    setPending(null);
  }, [value, pending]);
  const available =
    w.kind === "chooser" ? Array.isArray(optionsValue?.value.data) : !!topic;
  const enabled =
    connected && available && !["details", "readout"].includes(w.kind);
  const write = async (v: NtValue) => {
    try {
      if (!enabled) return;
      await invoke("write_topic", {
        topic: w.kind === "chooser" ? w.topic + "/selected" : w.topic,
        value: v,
      });
      setMessage("Published");
      if (w.kind !== "chooser")
        setPending({ value: v, timestamp: value?.timestamp ?? 0 });
    } catch (e) {
      setMessage(String(e));
    }
  };
  const commit = () => {
    try {
      if (type) void write(parseValue(type, draft));
    } catch (e) {
      setMessage(String(e));
    }
  };
  if (!available)
    return (
      <div className="missing">
        Waiting for topic
        <br />
        <small>{w.topic}</small>
      </div>
    );
  return (
    <div className="widget-content">
      {!connected && (
        <span className="stale">Disconnected · last received value</span>
      )}
      {w.kind === "boolean" && (
        <button
          className={"toggle " + (data ? "on" : "")}
          disabled={!enabled}
          onClick={() => void write(!data)}
        >
          {data ? "ON" : "OFF"}
        </button>
      )}
      {w.kind === "chooser" && (
        <>
          <select
            disabled={!enabled}
            value={typeof data === "string" ? data : ""}
            onChange={(e) => void write(e.target.value)}
          >
            <option value="">Select…</option>
            {(optionsValue?.value.data as NtValue[] | undefined)?.map((o) => (
              <option key={String(o)} value={String(o)}>
                {String(o)}
              </option>
            ))}
          </select>
          <small>Robot active: {String(activeValue?.value.data ?? "—")}</small>
        </>
      )}
      {w.kind === "selector" && (
        <select
          disabled={!enabled}
          value={w.options.findIndex(
            (o) => JSON.stringify(o.value) === JSON.stringify(data),
          )}
          onChange={(e) => {
            try {
              const o = w.options[Number(e.target.value)];
              if (type && o) void write(validateValue(type, o.value));
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          <option value={-1}>Current: {String(data ?? "—")}</option>
          {w.options.map((o, i) => (
            <option key={i} value={i}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {w.kind === "slider" && (
        <>
          <output>{String(data ?? "—")}</output>
          <input
            type="range"
            disabled={!enabled || !type || type === "int"}
            min={w.min}
            max={w.max}
            step={w.step}
            value={typeof data === "number" ? data : w.min}
            onChange={(e) => void write(Number(e.target.value))}
          />
          {type === "int" && (
            <small>Use the numeric editor for precise 64-bit integers.</small>
          )}
        </>
      )}
      {["number", "string", "array"].includes(w.kind) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            aria-label={w.title}
            disabled={!enabled}
            value={draft}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
            }}
            onChange={(e) => setDraft(e.target.value)}
          />
          {enabled && <button type="submit">Apply</button>}
          {w.kind === "array" && type === "int[]" && (
            <small>Use quoted decimal integers.</small>
          )}
        </form>
      )}
      {["readout", "details"].includes(w.kind) && (
        <pre>
          {typeof data === "string"
            ? data
            : JSON.stringify(data ?? null, null, compact ? undefined : 2)}
        </pre>
      )}
      {value?.value.truncated && (
        <>
          <small>Preview truncated ({value.value.length} elements/bytes)</small>
          <button
            onClick={() =>
              void invoke<NtValue>("topic_details", { id: topic?.id })
                .then(setDetails)
                .catch((e) => setMessage(String(e)))
            }
          >
            Open full details
          </button>
        </>
      )}
      {details !== undefined && (
        <dialog open className="details-dialog">
          <button onClick={() => setDetails(undefined)}>Close</button>
          <textarea readOnly value={JSON.stringify(details, null, 2)} />
        </dialog>
      )}
      {!compact && value?.origin === "published" && (
        <small>
          Last received: {JSON.stringify(received?.value.data ?? null)}
        </small>
      )}
      {message && <small role="status">{message}</small>}
    </div>
  );
}
export const registry: Record<WidgetKind, WidgetDefinition> = {
  readout: {
    label: "Readout",
    compatible: () => true,
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  boolean: {
    label: "Boolean toggle",
    compatible: (t) => t === "boolean",
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  number: {
    label: "Numeric editor",
    compatible: numeric,
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  slider: {
    label: "Slider",
    compatible: (t) => ["float", "double"].includes(t),
    defaults: { min: 0, max: 1, step: 0.01 },
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  string: {
    label: "Text editor",
    compatible: (t) => ["string", "json"].includes(t),
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  array: {
    label: "Array editor",
    compatible: (t) =>
      ["boolean[]", "int[]", "float[]", "double[]", "string[]"].includes(t),
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  selector: {
    label: "Custom selector",
    compatible: scalar,
    defaults: { options: [] },
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  chooser: {
    label: "Sendable chooser",
    compatible: () => false,
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
  details: {
    label: "Raw / structured details",
    compatible: () => true,
    defaults: {},
    render: BuiltinWidget,
    settings: BuiltinSettings,
  },
};
export const WidgetBody = memo(function WidgetBody(props: WidgetProps) {
  const Renderer = registry[props.widget.kind].render;
  return <Renderer {...props} />;
});
