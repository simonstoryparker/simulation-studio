import { Updates } from "./Updates";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyTelemetry,
  getChoosers,
  getTopic,
  useCatalog,
  updateSticks,
  useSticks,
} from "./store";
import {
  createWidget,
  emptyWorkspace,
  controlCandidates,
  assignController,
  validateWorkspace,
} from "./workspace";
import { registry, WidgetBody } from "./widgets";
const Controller3D = lazy(() => import("./Controller3D"));
import type {
  AppliedControlState,
  Device,
  Endpoints,
  Joystick,
  PortProfile,
  TelemetryBatch,
  TopicDescriptor,
  WidgetInstance,
  WidgetKind,
  Workspace,
} from "./types";
const Grid = WidthProvider(GridLayout);
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const command = <T,>(name: string, args?: Record<string, unknown>) =>
  invoke<T>(name, args);

function StudioMark() {
  return (
    <svg
      className="studio-mark"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 23h7l5-14 5 14h9M3 9h5m16 0h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Icon({
  name,
}: {
  name:
    "settings" | "compact" | "import" | "export" | "keyboard" | "controller";
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "settings" ? (
        <>
          <path d="m9.5 3-.6 2.2-1.8 1L5 5.7 2.5 10l1.6 1.6v.8L2.5 14 5 18.3l2.1-.5 1.8 1 .6 2.2h5l.6-2.2 1.8-1 2.1.5 2.5-4.3-1.6-1.6v-.8l1.6-1.6L19 5.7l-2.1.5-1.8-1L14.5 3z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : name === "compact" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <rect x="12" y="12" width="6" height="5" rx=".5" />
        </>
      ) : name === "keyboard" ? (
        <>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" />
        </>
      ) : name === "controller" ? (
        <>
          <path d="M8 7h8c2 0 3.2 1.5 3.7 3.3l1.1 5.4c.5 2.5-1.7 3.8-3.2 2.1L15 15H9l-2.6 2.8c-1.5 1.7-3.7.4-3.2-2.1l1.1-5.4C4.8 8.5 6 7 8 7Z" />
          <path d="M8 10v4m-2-2h4m6-2h.01m2 3h.01" />
        </>
      ) : (
        <>
          <path d="M4 15v5h16v-5" />
          {name === "import" ? (
            <path d="M12 3v12m-4-4 4 4 4-4" />
          ) : (
            <path d="M12 15V3m-4 4 4-4 4 4" />
          )}
        </>
      )}
    </svg>
  );
}

function InputMark({
  kind,
  label,
  number,
}: {
  kind: "keyboard" | "controller";
  label: string;
  number?: number;
}) {
  return (
    <span className="input-mark" role="img" aria-label={label} title={label}>
      <Icon name={kind} />
      {number !== undefined && <sub>{number}</sub>}
    </span>
  );
}

function PortInputs({
  profile,
  port,
  keyboardPort,
  devices,
}: {
  profile: PortProfile;
  port: number;
  keyboardPort: number;
  devices: Device[];
}) {
  const deviceIndex = devices.findIndex(
    (device) => profile.source === `gamepad:${device.id}`,
  );
  return (
    <span className="port-inputs">
      {keyboardPort === port && <InputMark kind="keyboard" label="Keyboard" />}
      {profile.source.startsWith("gamepad:") && (
        <InputMark
          kind="controller"
          label={
            deviceIndex >= 0
              ? `Controller ${deviceIndex + 1}: ${devices[deviceIndex].name}`
              : "Controller disconnected"
          }
          number={
            devices.length > 1 && deviceIndex >= 0 ? deviceIndex + 1 : undefined
          }
        />
      )}
    </span>
  );
}

function TopicRow({
  topic,
  add,
  added,
}: {
  topic: { name: string; type: string; chooser: boolean };
  add: (name: string, type: string) => void;
  added: boolean;
}) {
  const parts = topic.name.split("/").filter(Boolean);
  return (
    <button
      className="topic-row"
      title={topic.name}
      disabled={added}
      aria-label={`${added ? "Added" : "Add"} ${topic.name}`}
      onClick={() => add(topic.name, topic.type)}
      draggable={!added}
      onDragStart={(event) =>
        event.dataTransfer.setData(
          "application/x-nt-topic",
          JSON.stringify(topic),
        )
      }
    >
      <span>{parts.at(-1)}</span>
      <small>
        {topic.chooser
          ? "Chooser"
          : topic.type === "boolean"
            ? "Toggle"
            : topic.type}{" "}
        · {parts.slice(0, -1).join("/") || "/"}
      </small>
      <b>{added ? "Added" : "+"}</b>
    </button>
  );
}
const Browser = memo(function Browser({
  add,
  openAll,
  busy,
  widgets,
  expanded,
  onToggle,
}: {
  add: (name: string, type: string) => void;
  openAll: (prefix: string) => void;
  busy: boolean;
  widgets: WidgetInstance[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const catalog = useCatalog();
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [scroll, setScroll] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver((entries) =>
      setHeight(entries[0].contentRect.height),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [expanded]);
  const rows = useMemo(
    () =>
      controlCandidates("/", catalog, getChoosers(), []).filter((topic) =>
        topic.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [catalog, search],
  );
  useEffect(() => {
    setScroll(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [search, expanded]);
  const start = Math.max(0, Math.floor(scroll / 40) - 3);
  const end = Math.min(rows.length, Math.ceil((scroll + height) / 40) + 3);
  return (
    <aside
      className="browser control-picker"
      aria-label="NetworkTables selectors"
    >
      <div className="panel-heading">
        <h2>
          <button
            className="selector-toggle"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>Add selector
          </button>
        </h2>
        {expanded && (
          <button
            className="icon-button"
            aria-label="Filter selectors"
            title="Filter selectors"
            aria-expanded={filterOpen}
            onClick={() => {
              setFilterOpen(!filterOpen);
              setSearch("");
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
          </button>
        )}
      </div>
      {expanded && (
        <>
          {filterOpen && (
            <div className="control-filter">
              <input
                autoFocus
                aria-label="Search selectors"
                placeholder="Find a selector…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                disabled={busy || !rows.length}
                onClick={() => openAll("/")}
                title="Add all published selectors, regardless of the filter"
              >
                {busy ? "Adding…" : "Add all"}
              </button>
            </div>
          )}
          <div
            ref={viewport}
            className="topic-list"
            style={{ height: Math.min(200, Math.max(40, rows.length * 40)) }}
            onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
          >
            <div style={{ height: rows.length * 40, position: "relative" }}>
              {rows.slice(start, end).map((topic, index) => (
                <div
                  key={topic.name}
                  style={{
                    position: "absolute",
                    top: (start + index) * 40,
                    height: 40,
                    left: 0,
                    right: 0,
                  }}
                >
                  <TopicRow
                    topic={topic}
                    add={add}
                    added={widgets.some(
                      (widget) => widget.topic === topic.name,
                    )}
                  />
                </div>
              ))}
            </div>
            {!rows.length && (
              <p className="topic-empty">
                {search
                  ? "No matching selectors."
                  : "No selectors published yet."}
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
});
const Card = memo(function Card({
  widget,
  connected,
  onSettings,
  onRemove,
  onDuplicate,
}: {
  widget: WidgetInstance;
  connected: boolean;
  onSettings: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: "80px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={element} className="widget-card">
      <header className="widget-handle">
        <strong title={widget.topic}>{widget.title}</strong>
        <div className="widget-actions">
          <button
            title="Duplicate"
            aria-label={`Duplicate ${widget.title}`}
            onClick={() => onDuplicate(widget.id)}
          >
            ⧉
          </button>
          <button
            title="Settings"
            aria-label={`Settings for ${widget.title}`}
            onClick={() => onSettings(widget.id)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 5h14M3 15h14M7 2v6m6 4v6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
          <button
            title="Remove"
            aria-label={`Remove ${widget.title}`}
            onClick={() => onRemove(widget.id)}
          >
            ×
          </button>
        </div>
      </header>
      {visible && <WidgetBody widget={widget} connected={connected} />}
    </div>
  );
});
function WidgetSettings({
  widget,
  onSave,
  onClose,
}: {
  widget: WidgetInstance;
  onSave: (w: WidgetInstance) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(widget);
  const topic = getTopic(widget.topic);
  const Definition = registry[draft.kind];
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <h2>Widget settings</h2>
        <code>{widget.topic}</code>
        <small>NT type: {topic?.type ?? "chooser"}</small>
        <details>
          <summary>Topic properties</summary>
          <pre>{JSON.stringify(topic?.properties ?? {}, null, 2)}</pre>
        </details>
        <label>
          Title
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label>
          Widget type
          <select
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as WidgetKind;
              setDraft({ ...draft, ...registry[kind].defaults, kind });
            }}
          >
            {Object.entries(registry)
              .filter(
                ([kind, d]) =>
                  kind === widget.kind || d.compatible(topic?.type ?? ""),
              )
              .map(([kind, d]) => (
                <option key={kind} value={kind}>
                  {d.label}
                </option>
              ))}
          </select>
        </label>
        <Definition.settings widget={draft} onChange={setDraft} />
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              if (
                draft.kind === "slider" &&
                (draft.min >= draft.max || draft.step <= 0)
              )
                return;
              onSave(draft);
            }}
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
}
function ControllerPanel({
  profiles,
  devices,
  keyboardPort,
  onKeyboardPort,
  onChange,
  onClose,
}: {
  profiles: PortProfile[];
  devices: Device[];
  keyboardPort: number;
  onKeyboardPort: (port: number) => void;
  onChange: (profiles: PortProfile[]) => void;
  onClose: () => void;
}) {
  const sticks = useSticks();
  const [port, setPort] = useState(0),
    [draft, setDraft] = useState(profiles[0]);
  const [error, setError] = useState(""),
    [capture, setCapture] = useState<string | null>(null);
  const [view, setView] = useState<"front" | "top">("front");
  useEffect(() => setDraft(profiles[port]), [profiles, port]);
  const captureCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => captureCleanup.current?.(), []);
  const save = (next = draft) => {
    const profilesNext = profiles.map((p, i) => (i === port ? next : p));
    void command("set_profiles", { profiles: profilesNext })
      .then(() => {
        onChange(profilesNext);
        setError("");
      })
      .catch((e) => setError(String(e)));
  };
  const choosePort = (i: number) => {
    captureCleanup.current?.();
    captureCleanup.current = undefined;
    setPort(i);
    setDraft(profiles[i]);
    setCapture(null);
  };
  const binding = (target: string) => {
    captureCleanup.current?.();
    void command("set_keys", { keys: [] }).catch(console.error);
    window.dispatchEvent(new Event("sim-clear-keys"));
    setCapture(target);
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapture(null);
        window.removeEventListener("keydown", down, true);
        captureCleanup.current = undefined;
        return;
      }
      const axes = draft.axes.map((a) =>
        target === `${a.input}:negative`
          ? { ...a, negative: e.code }
          : target === `${a.input}:positive`
            ? { ...a, positive: e.code }
            : a,
      );
      const buttons = draft.buttons.map((b) =>
        target === b.input ? { ...b, key: e.code } : b,
      );
      const pov = draft.pov.map((key, i) =>
        target === `DPad:${i}` ? e.code : key,
      );
      const next = { ...draft, axes, buttons, pov };
      setDraft(next);
      save(next);
      setCapture(null);
      window.removeEventListener("keydown", down, true);
      captureCleanup.current = undefined;
    };
    window.addEventListener("keydown", down, true);
    captureCleanup.current = () =>
      window.removeEventListener("keydown", down, true);
  };
  const clearBinding = (target: string) => {
    captureCleanup.current?.();
    captureCleanup.current = undefined;
    setCapture(null);
    const next = {
      ...draft,
      axes: draft.axes.map((a) =>
        target === `${a.input}:negative`
          ? { ...a, negative: "" }
          : target === `${a.input}:positive`
            ? { ...a, positive: "" }
            : a,
      ),
      buttons: draft.buttons.map((b) =>
        target === b.input ? { ...b, key: "" } : b,
      ),
      pov: draft.pov.map((k, i) => (target === `DPad:${i}` ? "" : k)),
    };
    setDraft(next);
    save(next);
  };
  const keyFor = (target: string) =>
    draft.axes
      .flatMap(
        (a) =>
          [
            [`${a.input}:negative`, a.negative],
            [`${a.input}:positive`, a.positive],
          ] as [string, string][],
      )
      .find(([id]) => id === target)?.[1] ??
    draft.buttons.find((b) => b.input === target)?.key ??
    (target.startsWith("DPad:") ? draft.pov[Number(target.slice(-1))] : "");
  const axisTargets = draft.axes.flatMap((a) => {
    if (a.input === "LeftZ" || a.input === "RightZ")
      return [
        [
          `${a.input}:positive`,
          a.input === "LeftZ" ? "Left trigger" : "Right trigger",
        ],
      ] as [string, string][];
    const labels: Record<string, [string, string]> = {
      LeftStickX: ["Left stick left", "Left stick right"],
      LeftStickY: ["Left stick down", "Left stick up"],
      RightStickX: ["Right stick left", "Right stick right"],
      RightStickY: ["Right stick down", "Right stick up"],
    };
    const pair = labels[a.input] ?? [`${a.input} −`, `${a.input} +`];
    return [
      [`${a.input}:negative`, pair[0]],
      [`${a.input}:positive`, pair[1]],
    ] as [string, string][];
  });
  return (
    <section className="controllers-page">
      <header>
        <div>
          <h1>Controllers</h1>
          <p>Assign devices and tune keyboard bindings for each port.</p>
        </div>
        <button onClick={onClose}>Workspace</button>
      </header>
      <div className="controller-layout">
        <div className="port-list">
          {profiles.map((p, i) => {
            const source = p.source.startsWith("gamepad:")
              ? (devices.find((d) => `gamepad:${d.id}` === p.source)?.name ??
                "Device unavailable")
              : "No controller";
            return (
              <button
                key={i}
                className={port === i ? "selected" : ""}
                aria-pressed={port === i}
                onClick={() => choosePort(i)}
              >
                <span className="port-name">
                  <span>Port {i}</span>
                  <strong>{p.name}</strong>
                  <PortInputs
                    profile={p}
                    port={i}
                    keyboardPort={keyboardPort}
                    devices={devices}
                  />
                </span>
                <small>{source}</small>
              </button>
            );
          })}
        </div>
        <div className="controller-editor">
          <div className="port-tabs">
            {keyboardPort !== port && (
              <button onClick={() => onKeyboardPort(port)}>
                <Icon name="keyboard" />
                Move keyboard here
              </button>
            )}
            <button onClick={() => setView(view === "front" ? "top" : "front")}>
              {view === "front" ? "Top view" : "Front view"}
            </button>
          </div>
          <div className="controller-fields">
            <label>
              Port name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onBlur={() => save()}
              />
            </label>
            <label>
              Physical controller
              <select
                value={draft.source}
                onChange={(e) => {
                  const next = { ...draft, source: e.target.value };
                  setDraft(next);
                  save(next);
                }}
              >
                <option value="none">None</option>
                {draft.source.startsWith("gamepad:") &&
                  !devices.some((d) => `gamepad:${d.id}` === draft.source) && (
                    <option value={draft.source}>
                      Assigned device unavailable
                    </option>
                  )}
                {devices.map((d) => (
                  <option key={d.id} value={`gamepad:${d.id}`}>
                    {d.name} · {d.id.slice(-5)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="controller-grid">
            <Suspense
              fallback={
                <div className="controller-canvas" role="status">
                  Loading controller…
                </div>
              }
            >
              <Controller3D
                active={capture}
                view={view}
                onSelect={(id) => {
                  binding(id);
                }}
              />
            </Suspense>
            <div className="binding-list">
              <h3>Keyboard bindings</h3>
              {draft.buttons.map((b) => {
                const label =
                  (
                    {
                      South: "A",
                      East: "B",
                      West: "X",
                      North: "Y",
                      LeftTrigger: "Left bumper",
                      RightTrigger: "Right bumper",
                      Select: "View",
                      Start: "Menu",
                      LeftThumb: "Left stick click",
                      RightThumb: "Right stick click",
                    } as Record<string, string>
                  )[b.input] ?? b.input;
                return (
                  <div key={b.input}>
                    <span>{label}</span>
                    <button onClick={() => binding(b.input)}>
                      {capture === b.input
                        ? "Press a key…"
                        : b.key || "Unbound"}
                    </button>
                    <button
                      aria-label={`Clear ${label} binding`}
                      onClick={() => clearBinding(b.input)}
                    >
                      Clear
                    </button>
                  </div>
                );
              })}
              {axisTargets.map(([id, label]) => (
                <div key={id}>
                  <span>{label}</span>
                  <button onClick={() => binding(id)}>
                    {capture === id ? "Press a key…" : keyFor(id) || "Unbound"}
                  </button>
                  <button
                    aria-label={`Clear ${label} binding`}
                    onClick={() => clearBinding(id)}
                  >
                    Clear
                  </button>
                </div>
              ))}
              {draft.pov.map((key, i) => (
                <div key={i}>
                  <span>
                    {["D-pad up", "D-pad right", "D-pad down", "D-pad left"][i]}
                  </span>
                  <button onClick={() => binding(`DPad:${i}`)}>
                    {capture === `DPad:${i}`
                      ? "Press a key…"
                      : key || "Unbound"}
                  </button>
                  <button onClick={() => clearBinding(`DPad:${i}`)}>
                    Clear
                  </button>
                </div>
              ))}
            </div>
          </div>
          <small>
            Preview:{" "}
            {sticks[port]?.axes.map((v) => v.toFixed(2)).join(" · ") ||
              "No input"}{" "}
            · POV {sticks[port]?.povs[0] ?? -1}
          </small>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </section>
  );
}
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace),
    [ready, setReady] = useState(false),
    [endpoints, setEndpoints] = useState<Endpoints>({
      control: "",
      nt: "",
      project: "",
    });
  const [connections, setConnections] = useState({ control: false, nt: false }),
    [applied, setApplied] = useState<AppliedControlState>(),
    [devices, setDevices] = useState<Device[]>([]);
  const [mode, setMode] = useState("teleop"),
    [alliance, setAlliance] = useState("Unknown"),
    [matchTime, setMatchTime] = useState(-1),
    [matchPhase, setMatchPhase] = useState("Disabled"),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState(""),
    [settings, setSettings] = useState<string>(),
    [controllers, setControllers] = useState(false),
    [compact, setCompact] = useState(false),
    [editingTab, setEditingTab] = useState<string | null>(null),
    [settingsPage, setSettingsPage] = useState(false),
    [mobilePanel, setMobilePanel] = useState<
      "workspace" | "controls" | "topics"
    >("workspace"),
    [busy, setBusy] = useState(false),
    [assigningController, setAssigningController] = useState(false),
    [updating, setUpdating] = useState(false);
  const [narrowCanvas, setNarrowCanvas] = useState(
    () => window.matchMedia?.("(max-width: 600px)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 600px)");
    if (!query) return;
    const update = () => setNarrowCanvas(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const compactTransition = useRef(false);
  const autoCompact = useRef(true);
  const compactContent = useRef<HTMLDivElement>(null);
  const compactState = useRef(compact);
  compactState.current = compact;
  const current = useRef({ workspace, endpoints, ready });
  current.current = { workspace, endpoints, ready };
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saveNow = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const c = current.current;
    if (c.ready)
      await command("save_workspace", {
        workspace: c.workspace,
        project: c.endpoints.project,
      });
  }, []);
  useEffect(() => {
    let cancelled = false;
    const cleanup: (() => void)[] = [];
    const load = async (ep: Endpoints) => {
      if (cancelled) return;
      setReady(false);
      const saved = await command<Workspace | null>("load_workspace", {
        project: ep.project,
      });
      const next = saved ? validateWorkspace(saved) : emptyWorkspace();
      if (cancelled) return;
      setWorkspace(next);
      setEndpoints(ep);
      await command("set_profiles", { profiles: next.profiles });
      await command("set_keyboard_port", { port: next.keyboardPort });
      setReady(true);
      void command("report_ready").catch(console.error);
    };
    void (async () => {
      const listeners = await Promise.all([
        listen<{ phase: string }>("update-status", (e) =>
          setUpdating(["preparing", "installing"].includes(e.payload.phase)),
        ),
        listen<TelemetryBatch>("telemetry", (e) => applyTelemetry(e.payload)),
        listen<{ service: "control" | "nt"; connected: boolean }>(
          "connection",
          (e) =>
            setConnections((old) => ({
              ...old,
              [e.payload.service]: e.payload.connected,
            })),
        ),
        listen<{ state: AppliedControlState; joysticks: Joystick[] }>(
          "applied",
          (e) => {
            setApplied((old) =>
              old?.enabled === e.payload.state.enabled &&
              old?.estop === e.payload.state.estop &&
              old?.mode === e.payload.state.mode
                ? old
                : e.payload.state,
            );
            updateSticks(e.payload.joysticks);
          },
        ),
        listen<Device[]>("devices", (e) => setDevices(e.payload)),
        listen<{
          phase: string;
          mode: string;
          enabled: boolean;
          matchTime: number;
          elapsed: number;
          fullMatch?: boolean;
        }>("match-state", (e) => {
          setMatchPhase(
            e.payload.phase.slice(0, 1).toUpperCase() +
              e.payload.phase.slice(1),
          );
          if (e.payload.fullMatch) setMode("full");
          setMatchTime(e.payload.matchTime);
          setElapsed(e.payload.elapsed);
        }),
        listen<{ width: number; height: number; x: number; y: number }>(
          "overlay-bounds",
          (e) =>
            setWorkspace((old) => ({
              ...old,
              overlay: { ...old.overlay, ...e.payload },
            })),
        ),
        listen<boolean>("compact-changed", (e) => {
          compactState.current = e.payload;
          setCompact(e.payload);
        }),
        listen<number>("keyboard-port", (e) =>
          setWorkspace((old) => ({ ...old, keyboardPort: e.payload })),
        ),
        listen<{ service: string; message: string }>("service-error", (e) =>
          setError(`${e.payload.service}: ${e.payload.message}`),
        ),
        listen<Endpoints>("session", (e) => {
          void saveNow()
            .then(() => {
              applyTelemetry({
                lifecycle: [{ method: "reset", topics: [] }],
                values: [],
              });
              return load(e.payload);
            })
            .catch((e) => setError(String(e)));
        }),
        getCurrentWindow().onCloseRequested(async (e) => {
          e.preventDefault();
          try {
            const update = await command<{ phase: string }>("update_status");
            if (["preparing", "installing"].includes(update.phase)) return;
            await saveNow();
            await getCurrentWindow().destroy();
          } catch (error) {
            setError(String(error));
          }
        }),
      ]);
      if (cancelled) {
        listeners.forEach((fn) => fn());
        return;
      }
      cleanup.push(...listeners);
      const boot = await command<{
        endpoints: Endpoints;
        controlConnected: boolean;
        ntConnected: boolean;
        topics: TopicDescriptor[];
        values: TelemetryBatch["values"];
        devices: Device[];
        applied: AppliedControlState;
        keyboardPort?: number;
        compact?: boolean;
        matchState: {
          phase: string;
          mode: string;
          elapsed: number;
          matchTime: number;
          fullMatch: boolean;
        };
      }>("bootstrap");
      applyTelemetry({
        lifecycle: [{ method: "reset", topics: boot.topics }],
        values: boot.values,
      });
      setConnections({ control: boot.controlConnected, nt: boot.ntConnected });
      setDevices(boot.devices);
      setCompact(!!boot.compact);
      if (boot.applied) {
        setApplied(boot.applied);
        setMode(boot.applied.mode);
      }
      if (boot.matchState) {
        setElapsed(boot.matchState.elapsed);
        setMatchTime(boot.matchState.matchTime);
        setMatchPhase(
          boot.matchState.phase.slice(0, 1).toUpperCase() +
            boot.matchState.phase.slice(1),
        );
        setMode(boot.matchState.fullMatch ? "full" : boot.matchState.mode);
      }
      await load(boot.endpoints);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, [saveNow]);
  useEffect(() => {
    if (!ready) return;
    saveTimer.current = setTimeout(
      () => void saveNow().catch((e) => setError(String(e))),
      500,
    );
    return () => clearTimeout(saveTimer.current);
  }, [workspace, ready, saveNow]);
  useEffect(() => {
    const keys = new Set<string>();
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      const profile =
        current.current.workspace.profiles[
          current.current.workspace.keyboardPort
        ];
      const bound =
        !!profile &&
        (profile.axes.some(
          (a) => a.negative === e.code || a.positive === e.code,
        ) ||
          profile.buttons.some((b) => b.key === e.code) ||
          profile.pov.includes(e.code));
      if (!bound) return;
      e.preventDefault();
      keys.add(e.code);
      void command("set_keys", { keys: [...keys] }).catch(console.error);
    };
    const up = (e: KeyboardEvent) => {
      if (keys.delete(e.code))
        void command("set_keys", { keys: [...keys] }).catch(console.error);
    };
    const clear = () => {
      keys.clear();
      void command("set_keys", { keys: [] }).catch(console.error);
    };
    const focusEditor = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        clear();
    };
    window.addEventListener("focusin", focusEditor);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    window.addEventListener("sim-clear-keys", clear);
    return () => {
      window.removeEventListener("focusin", focusEditor);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      window.removeEventListener("sim-clear-keys", clear);
    };
  }, []);
  const tab =
    workspace.tabs.find((t) => t.id === workspace.activeTab) ??
    workspace.tabs[0];
  const editWidgets = useCallback(
    (fn: (widgets: WidgetInstance[]) => WidgetInstance[]) =>
      setWorkspace((old) => ({
        ...old,
        tabs: old.tabs.map((t) =>
          t.id === old.activeTab ? { ...t, widgets: fn(t.widgets) } : t,
        ),
      })),
    [],
  );
  const add = useCallback(
    (name: string, type: string) => {
      editWidgets((widgets) => {
        const chooser = getChoosers().has(name.slice(0, name.lastIndexOf("/")))
          ? name.slice(0, name.lastIndexOf("/"))
          : getChoosers().has(name)
            ? name
            : null;
        const topic = chooser ?? name;
        if (widgets.some((w) => w.topic === topic)) return widgets;
        return [...widgets, createWidget(topic, type, widgets, !!chooser)];
      });
      setControllers(false);
      setMobilePanel("workspace");
    },
    [editWidgets],
  );
  const openAll = useCallback(async (prefix: string) => {
    setBusy(true);
    try {
      const c = current.current;
      const tabId = c.workspace.activeTab;
      const widgets = c.workspace.tabs.find((t) => t.id === tabId)!.widgets;
      const catalog = await command<{ topics: TopicDescriptor[] }>("bootstrap");
      const candidates = controlCandidates(
        prefix,
        catalog.topics,
        getChoosers(),
        widgets,
      );
      const baseY = widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
      let next = [...widgets];
      for (let i = 0; i < candidates.length; i += 32) {
        for (const [j, t] of candidates.slice(i, i + 32).entries()) {
          const index = i + j;
          const widget = createWidget(t.name, t.type, [], t.chooser);
          widget.x = (index % 3) * 4;
          widget.y = baseY + Math.floor(index / 3) * 4;
          next.push(widget);
        }
        const chunk = [...next];
        setWorkspace((old) => ({
          ...old,
          tabs: old.tabs.map((t) =>
            t.id === tabId ? { ...t, widgets: chunk } : t,
          ),
        }));
        await nextFrame();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const openFolder = useCallback(
    (prefix: string) => {
      void openAll(prefix).then(() => setMobilePanel("workspace"));
    },
    [openAll],
  );
  const remove = useCallback(
    (id: string) =>
      setWorkspace((old) => {
        const removed = old.tabs
          .find((t) => t.id === old.activeTab)
          ?.widgets.find((w) => w.id === id);
        const tabs = old.tabs.map((t) =>
          t.id === old.activeTab
            ? { ...t, widgets: t.widgets.filter((w) => w.id !== id) }
            : t,
        );
        const stillUsed =
          removed &&
          tabs.some((t) => t.widgets.some((w) => w.topic === removed.topic));
        return {
          ...old,
          tabs,
          overlay: {
            ...old.overlay,
            topics: stillUsed
              ? old.overlay.topics
              : old.overlay.topics.filter((name) => name !== removed?.topic),
          },
        };
      }),
    [],
  );
  const duplicate = useCallback(
    (id: string) =>
      editWidgets((w) => {
        const found = w.find((x) => x.id === id);
        return found
          ? [
              ...w,
              {
                ...found,
                id: crypto.randomUUID(),
                y: w.reduce((max, x) => Math.max(max, x.y + x.h), 0),
              },
            ]
          : w;
      }),
    [editWidgets],
  );
  const showSettings = useCallback((id: string) => setSettings(id), []);
  const layout = useMemo(
    () =>
      tab.widgets.map((w) => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: 2,
        minH: 3,
      })),
    [tab.widgets],
  );
  const updateLayout = (items: Layout[]) =>
    editWidgets((widgets) => {
      const byId = new Map(items.map((l) => [l.i, l]));
      let changed = false;
      const next = widgets.map((w) => {
        const l = byId.get(w.id);
        if (!l || (l.x === w.x && l.y === w.y && l.w === w.w && l.h === w.h))
          return w;
        changed = true;
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
      });
      return changed ? next : widgets;
    });
  const ds = async (
    enabled: boolean,
    estop = false,
    nextMode = mode,
    nextAlliance = alliance,
    nextTime = matchTime,
  ) => {
    try {
      await command("set_control", {
        enabled,
        estop,
        mode: nextMode === "full" ? "auto" : nextMode,
        alliance: nextAlliance,
        matchTime: nextTime,
      });
    } catch (e) {
      setError(String(e));
    }
  };
  const startMatch = async () => {
    try {
      await command("start_match", workspace.matchDurations);
      setMode("full");
      setMatchPhase("Auto");
      setElapsed(0);
    } catch (e) {
      setError(String(e));
    }
  };
  const changeCompact = useCallback(async (next: boolean) => {
    if (compactTransition.current || compactState.current === next) return;
    compactTransition.current = true;
    const { overlay } = current.current.workspace;
    try {
      const bounds = await command<{
        width: number;
        height: number;
        x: number;
        y: number;
      } | null>("set_compact", {
        compact: next,
        width: overlay.width,
        height: Math.max(overlay.height, overlay.topics.length ? 96 : 56),
        x: overlay.x,
        y: overlay.y,
      });
      if (bounds)
        setWorkspace((old) => ({
          ...old,
          overlay: { ...old.overlay, ...bounds },
        }));
      compactState.current = next;
      setCompact(next);
    } catch (e) {
      setError(String(e));
    } finally {
      compactTransition.current = false;
    }
  }, []);
  const toggleCompact = () => {
    autoCompact.current = true;
    return changeCompact(!compactState.current);
  };
  const dismissCompact = () => {
    autoCompact.current = false;
    void changeCompact(false);
  };
  useEffect(() => {
    document.documentElement.classList.toggle("compact-window", compact);
    return () => document.documentElement.classList.remove("compact-window");
  }, [compact]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (disposed || !current.current.ready) return;
        if (!focused && autoCompact.current) void changeCompact(true);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [changeCompact]);
  useEffect(() => {
    const content = compactContent.current;
    if (!compact || !content) return;
    let frame = 0;
    let disposed = false;
    let previousSize = "";
    const fit = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        const rect = content.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const width = Math.max(
          320,
          Math.min(
            Math.ceil(rect.width + 42),
            (screen.availWidth || 2560) - 24,
          ),
        );
        const height = Math.max(
          56,
          Math.min(
            Math.ceil(rect.height + 18),
            (screen.availHeight || 1440) - 24,
          ),
        );
        const size = `${width}:${height}`;
        if (size === previousSize) return;
        previousSize = size;
        void command("resize_compact", { width, height }).catch((e) =>
          setError(String(e)),
        );
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    void document.fonts?.ready.then(fit);
    fit();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [compact]);
  const exportWorkspace = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(workspace, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${endpoints.project}-workspace.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importWorkspace = async (file: File) => {
    try {
      if (file.size > 8 * 1024 * 1024) throw Error("Workspace exceeds 8 MiB");
      const next = validateWorkspace(JSON.parse(await file.text()));
      await command("set_profiles", { profiles: next.profiles });
      await command("set_keyboard_port", { port: next.keyboardPort });
      setWorkspace(next);
    } catch (e) {
      setError(String(e));
    }
  };
  const selected = tab.widgets.find((w) => w.id === settings);
  const setKeyboardPort = (port: number) => {
    window.dispatchEvent(new Event("sim-clear-keys"));
    setWorkspace((old) => ({ ...old, keyboardPort: port }));
    void command("set_keyboard_port", { port }).catch((e) =>
      setError(String(e)),
    );
  };
  const setControllerPort = async (deviceId: string, port: number) => {
    if (assigningController) return;
    setAssigningController(true);
    const profiles = assignController(
      current.current.workspace.profiles,
      deviceId,
      port,
    );
    try {
      await command("set_profiles", { profiles });
      setWorkspace((old) => ({ ...old, profiles }));
    } catch (error) {
      setError(String(error));
    } finally {
      setAssigningController(false);
    }
  };
  const overlayTopics = workspace.overlay.topics;
  const allWidgets = workspace.tabs.flatMap((t) => t.widgets);
  const compactTopics = overlayTopics
    .map((name) => allWidgets.find((w) => w.topic === name))
    .filter((w): w is WidgetInstance => !!w);
  const showOverlayControl = (id: string) =>
    workspace.overlay.controls.includes(id);
  const setOverlayControl = (id: string, checked: boolean) =>
    setWorkspace((old) => ({
      ...old,
      overlay: {
        ...old.overlay,
        controls: checked
          ? [...new Set([...old.overlay.controls, id])]
          : old.overlay.controls.filter((v) => v !== id),
      },
    }));
  const pickCompactTopic = (topic: string, checked: boolean) =>
    setWorkspace((old) => ({
      ...old,
      overlay: {
        ...old.overlay,
        topics: checked
          ? [...new Set([...old.overlay.topics, topic])]
          : old.overlay.topics.filter((v) => v !== topic),
      },
    }));
  const moveOverlayTopic = (index: number, direction: -1 | 1) =>
    setWorkspace((old) => {
      const topics = [...old.overlay.topics],
        next = index + direction;
      if (next < 0 || next >= topics.length) return old;
      [topics[index], topics[next]] = [topics[next], topics[index]];
      return { ...old, overlay: { ...old.overlay, topics } };
    });
  const enableSelected = Boolean(
    connections.control && applied?.enabled && !applied.estop,
  );
  const disableSelected = Boolean(
    connections.control && applied && !applied.enabled && !applied.estop,
  );
  if (compact)
    return (
      <div className="compact-app" data-tauri-drag-region>
        <div
          className="compact-content"
          ref={compactContent}
          data-tauri-drag-region
        >
          <div className="compact-bar" data-tauri-drag-region>
            <header className="compact-header" data-tauri-drag-region>
              <strong data-tauri-drag-region>
                {endpoints.project || "Simulation"}
              </strong>
              <span
                title={
                  connections.control
                    ? "Control connected"
                    : "Control disconnected"
                }
                className={connections.control ? "online" : "offline"}
              >
                {connections.control ? "●" : "○"}
              </span>
              <button
                className="compact-expand"
                title="Open Studio"
                aria-label="Expand simulation window"
                onClick={() => void toggleCompact()}
              >
                ↗
              </button>
            </header>
            <div className="compact-status">
              <strong>
                {applied?.estop
                  ? "E-STOPPED"
                  : connections.control && applied?.enabled
                    ? "ENABLED"
                    : "DISABLED"}
              </strong>
              <span title={`${matchPhase} · ${Math.floor(elapsed)}s elapsed`}>
                {mode === "full"
                  ? `${Math.ceil(matchTime)}s left`
                  : `${Math.floor(elapsed)}s`}
              </span>
            </div>
            <div className="compact-actions">
              <button
                className="enable"
                aria-pressed={enableSelected}
                disabled={!connections.control || applied?.estop}
                onClick={() =>
                  mode === "full" ? void startMatch() : void ds(true)
                }
              >
                Enable
              </button>
              <button
                className="disable"
                aria-pressed={disableSelected}
                onClick={() => void ds(false)}
              >
                Disable
              </button>
              {showOverlayControl("estop") && (
                <button className="estop" onClick={() => void ds(false, true)}>
                  E-stop
                </button>
              )}
            </div>
            {showOverlayControl("mode") && (
              <div className="compact-modes">
                <select
                  aria-label="Robot mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    void ds(
                      false,
                      false,
                      e.target.value === "full" ? "auto" : e.target.value,
                    );
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="teleop">Teleop</option>
                  <option value="test">Test</option>
                  <option value="full">Full Match</option>
                </select>
              </div>
            )}
            {showOverlayControl("keyboard") && (
              <div
                className="compact-ports"
                role="group"
                aria-label="Controller ports and keyboard destination"
              >
                {workspace.profiles.map((p, i) => {
                  if (
                    i > 1 &&
                    workspace.keyboardPort !== i &&
                    !showOverlayControl("extraPorts")
                  )
                    return null;
                  const physical = p.source.startsWith("gamepad:")
                    ? (devices.find((d) => `gamepad:${d.id}` === p.source)
                        ?.name ?? "Unavailable")
                    : "None";
                  return (
                    <button
                      key={i}
                      className={workspace.keyboardPort === i ? "selected" : ""}
                      title={`Port ${i}: ${p.name}; controller ${physical}; ${workspace.keyboardPort === i ? "keyboard destination" : ""}`}
                      onClick={() => setKeyboardPort(i)}
                    >
                      <span className="compact-port-number">
                        {i}
                        <PortInputs
                          profile={p}
                          port={i}
                          keyboardPort={workspace.keyboardPort}
                          devices={devices}
                        />
                      </span>
                      <small>{p.name}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {showOverlayControl("alliance") && (
              <select
                className="compact-alliance"
                aria-label="Alliance"
                value={alliance}
                onChange={(e) => {
                  setAlliance(e.target.value);
                  void ds(false, false, mode, e.target.value);
                }}
              >
                {[
                  "Unknown",
                  "Red1",
                  "Red2",
                  "Red3",
                  "Blue1",
                  "Blue2",
                  "Blue3",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            )}
          </div>
          <div className="compact-widgets">
            {compactTopics.map((w) => (
              <article key={w.id}>
                <strong>{w.title}</strong>
                <WidgetBody widget={w} connected={connections.nt} compact />
              </article>
            ))}
          </div>
          {error && (
            <div className="compact-error" role="alert">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
        </div>
        <button
          className="compact-close"
          aria-label="Dismiss compact overlay"
          title="Dismiss until Compact is clicked in Studio"
          onClick={dismissCompact}
        >
          ×
        </button>
      </div>
    );
  return (
    <div className={`app view-${mobilePanel}`}>
      <header className="topbar">
        <div
          className="studio-brand"
          title="Simulation Studio"
          aria-label="Simulation Studio"
        >
          <StudioMark />
        </div>
        <div className="project-title" title={endpoints.project}>
          <strong>
            {endpoints.project.split(/[\\/]/).filter(Boolean).at(-1) ||
              "No project connected"}
          </strong>
        </div>
        <div className="connection-status" aria-label="Connections">
          <span
            title={`Control bridge ${connections.control ? "connected" : "offline"}`}
            aria-label={`Control bridge ${connections.control ? "connected" : "offline"}`}
            className={connections.control ? "online" : "offline"}
          >
            <i />
            Control
          </span>
          <span
            title={`NetworkTables ${connections.nt ? "connected" : "offline"}`}
            aria-label={`NetworkTables ${connections.nt ? "connected" : "offline"}`}
            className={connections.nt ? "online" : "offline"}
          >
            <i />
            NT4
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="Compact"
          title="Open compact overlay"
          onClick={() => void toggleCompact()}
        >
          <Icon name="compact" />
        </button>
        <button
          className="icon-button"
          onClick={() => setSettingsPage((open) => !open)}
          aria-pressed={settingsPage}
          aria-label="Studio settings"
          title={settingsPage ? "Back to workspace" : "Settings"}
        >
          <Icon name="settings" />
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {updating && (
        <div className="update-shield" role="status">
          Installing update…
        </div>
      )}
      {settingsPage ? (
        <main className="settings-page">
          <header>
            <div>
              <h1>Settings</h1>
              <p>Local connections, compact controls, and app updates.</p>
            </div>
            <button onClick={() => setSettingsPage(false)}>
              Back to workspace
            </button>
          </header>
          <div className="settings-grid">
            <ConnectionSettings
              endpoints={endpoints}
              onConnect={async (next) => {
                try {
                  await saveNow();
                  await command("connect", { endpoints: next });
                  const saved = await command<Workspace | null>(
                    "load_workspace",
                    {
                      project: next.project,
                    },
                  );
                  const w = saved ? validateWorkspace(saved) : emptyWorkspace();
                  await command("set_profiles", { profiles: w.profiles });
                  await command("set_keyboard_port", { port: w.keyboardPort });
                  setWorkspace(w);
                  setEndpoints(next);
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
            <section className="settings-card overlay-settings">
              <div className="settings-section-intro">
                <h2>Compact overlay</h2>
                <p>
                  Keep robot controls nearby while working in another viewer.
                </p>
                <small className="settings-save-note">
                  Changes save automatically.
                </small>
              </div>
              <div className="settings-panel">
                <button onClick={toggleCompact}>Open compact overlay</button>
                <h3>Controls</h3>
                <div className="overlay-option-list">
                  {[
                    ["mode", "Mode selector"],
                    ["alliance", "Alliance"],
                    ["estop", "E-stop"],
                    ["keyboard", "Keyboard ports"],
                    ["extraPorts", "Include ports 2–5"],
                  ].map(([id, label]) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={showOverlayControl(id)}
                        onChange={(e) =>
                          setOverlayControl(id, e.target.checked)
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <h3>Topics</h3>
                {allWidgets.length === 0 && (
                  <p className="settings-empty">No widget topics.</p>
                )}
                {allWidgets.map((w) => (
                  <label key={w.id}>
                    <input
                      type="checkbox"
                      checked={overlayTopics.includes(w.topic)}
                      onChange={(e) =>
                        pickCompactTopic(w.topic, e.target.checked)
                      }
                    />
                    {w.title}
                  </label>
                ))}
                {overlayTopics.map((name, i) => (
                  <div className="topic-order" key={name}>
                    <span>{name}</span>
                    <button
                      disabled={i === 0}
                      aria-label={`Move ${name} up`}
                      onClick={() => moveOverlayTopic(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      disabled={i === overlayTopics.length - 1}
                      aria-label={`Move ${name} down`}
                      onClick={() => moveOverlayTopic(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <Updates
              connected={connections.control || connections.nt}
              save={saveNow}
            />
          </div>
        </main>
      ) : (
        <div className="workbench">
          <nav className="mobile-navigation" aria-label="Workbench panels">
            {(
              [
                ["workspace", "Workspace"],
                ["controls", "Robot controls"],
                ["topics", "Selectors"],
              ] as const
            ).map(([panel, label]) => (
              <button
                key={panel}
                aria-pressed={mobilePanel === panel}
                onClick={() => setMobilePanel(panel)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="main">
            <aside className="left-column">
              <section className="robot-controls" aria-label="Driver station">
                <div className="control-row">
                  <button
                    className="enable large"
                    aria-pressed={enableSelected}
                    disabled={!connections.control || applied?.estop || busy}
                    onClick={() =>
                      mode === "full" ? void startMatch() : void ds(true)
                    }
                  >
                    Enable
                  </button>
                  <button
                    className="disable large"
                    aria-pressed={disableSelected}
                    onClick={() => void ds(false)}
                  >
                    Disable
                  </button>
                </div>
                {!connections.control && (
                  <p className="connection-hint">
                    Connect the control bridge to enable your robot.{" "}
                    <button onClick={() => setSettingsPage(true)}>
                      Connection settings
                    </button>
                  </p>
                )}
                <div className="control-selectors">
                  <div
                    className="mode-selector"
                    role="group"
                    aria-label="Robot mode"
                  >
                    <div className="mode-buttons">
                      {[
                        ["auto", "Auto"],
                        ["teleop", "Teleop"],
                        ["full", "Full Match"],
                        ["test", "Test"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={mode === value ? "selected" : ""}
                          aria-pressed={mode === value}
                          onClick={() => {
                            if (value === "full") {
                              setMode("full");
                              void ds(false, false, "auto");
                            } else {
                              setMode(value);
                              void ds(false, false, value);
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    className="alliance-selector"
                    role="group"
                    aria-label="Alliance station"
                  >
                    <div className="alliance-buttons">
                      {["Red", "Blue"].map((team) => (
                        <div className="alliance-team" key={team}>
                          <span>{team}</span>
                          <div className="alliance-stations">
                            {[1, 2, 3].map((station) => {
                              const value = `${team}${station}`;
                              return (
                                <button
                                  key={value}
                                  className={
                                    alliance === value ? "selected" : ""
                                  }
                                  aria-label={`${team} station ${station}`}
                                  aria-pressed={alliance === value}
                                  title={
                                    alliance === value
                                      ? "Click again to clear alliance"
                                      : `${team} station ${station}`
                                  }
                                  onClick={() => {
                                    const next =
                                      alliance === value ? "Unknown" : value;
                                    setAlliance(next);
                                    void ds(false, false, mode, next);
                                  }}
                                >
                                  {station}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="state-time">
                  <div className="state-time-details">
                    <strong
                      className={
                        applied?.estop
                          ? "latched"
                          : applied?.enabled
                            ? "enabled"
                            : ""
                      }
                    >
                      {applied?.estop
                        ? "E-stop latched"
                        : connections.control && applied?.enabled
                          ? "Enabled"
                          : "Disabled"}
                    </strong>
                    <span>
                      {mode === "full"
                        ? `${matchPhase} · ${Math.floor(elapsed)}s elapsed · ${Math.ceil(matchTime)}s remaining`
                        : `${Math.floor(elapsed)}s elapsed`}
                    </span>
                  </div>
                  <button
                    className={applied?.estop ? "estop latched" : "estop"}
                    title="Emergency stop — latched until simulation restart"
                    onClick={() => void ds(false, true)}
                  >
                    {applied?.estop ? "E-stop latched" : "E-stop"}
                  </button>
                </div>
                {applied?.estop && (
                  <small className="estop-note">
                    Latched until simulation restart
                  </small>
                )}
                {mode === "full" && (
                  <div className="duration-fields">
                    <strong>Full Match durations (seconds)</strong>
                    {(
                      [
                        ["auto", "Auto"],
                        ["transition", "Disabled transition"],
                        ["teleop", "Teleop"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          disabled={["Auto", "Transition", "Teleop"].includes(
                            matchPhase,
                          )}
                          type="number"
                          min="0"
                          max="3600"
                          value={workspace.matchDurations[key]}
                          onChange={(e) =>
                            setWorkspace((old) => ({
                              ...old,
                              matchDurations: {
                                ...old.matchDurations,
                                [key]: Number(e.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="keyboard-dest">
                  <strong className="keyboard-port-label">
                    <InputMark kind="keyboard" label="Keyboard" />
                    <span>Keyboard port</span>
                  </strong>
                  <div>
                    {workspace.profiles.map((p, i) => (
                      <button
                        key={i}
                        className={
                          workspace.keyboardPort === i ? "selected" : ""
                        }
                        aria-label={`Keyboard port ${i}: ${p.name}`}
                        aria-pressed={workspace.keyboardPort === i}
                        title={p.name}
                        onClick={() => setKeyboardPort(i)}
                      >
                        <span>{i}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {devices.map((device, deviceIndex) => (
                  <div
                    className="keyboard-dest device-port-row"
                    role="group"
                    aria-label={`${device.name} port`}
                    aria-busy={assigningController}
                    key={device.id}
                  >
                    <strong className="device-port-label" title={device.name}>
                      <InputMark
                        kind="controller"
                        label={`Controller ${deviceIndex + 1}: ${device.name}`}
                        number={
                          devices.length > 1 ? deviceIndex + 1 : undefined
                        }
                      />
                      <span className="device-name">{device.name}</span>
                    </strong>
                    <div>
                      {workspace.profiles.map((profile, port) => {
                        const selected =
                          profile.source === `gamepad:${device.id}`;
                        const occupied = devices.find(
                          (other) =>
                            `gamepad:${other.id}` === profile.source &&
                            other.id !== device.id,
                        );
                        const assigned = workspace.profiles.some(
                          (profile) =>
                            profile.source === `gamepad:${device.id}`,
                        );
                        return (
                          <button
                            key={port}
                            className={selected ? "selected" : ""}
                            aria-pressed={selected}
                            aria-label={`Port ${port}: ${profile.name}`}
                            disabled={assigningController}
                            title={`${profile.name}${occupied ? ` · ${assigned ? "Swap with" : "Replace"} ${occupied.name}` : ""}`}
                            onClick={() =>
                              void setControllerPort(device.id, port)
                            }
                          >
                            {port}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
              <Browser
                add={add}
                openAll={openFolder}
                busy={busy}
                widgets={tab.widgets}
                expanded={!workspace.topicsCollapsed}
                onToggle={() =>
                  setWorkspace((old) => ({
                    ...old,
                    topicsCollapsed: !old.topicsCollapsed,
                  }))
                }
              />
            </aside>
            <section className="workspace">
              <nav className="tabs" aria-label="Workspaces">
                {workspace.tabs.map((t) => (
                  <div className="tab-item" key={t.id}>
                    {editingTab === t.id ? (
                      <input
                        autoFocus
                        aria-label="Rename workspace"
                        value={t.name}
                        onChange={(e) =>
                          setWorkspace((old) => ({
                            ...old,
                            tabs: old.tabs.map((x) =>
                              x.id === t.id
                                ? { ...x, name: e.target.value }
                                : x,
                            ),
                          }))
                        }
                        onBlur={() => setEditingTab(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setEditingTab(null);
                          if (e.key === "Escape") setEditingTab(null);
                        }}
                      />
                    ) : (
                      <button
                        className={
                          !controllers && t.id === tab.id ? "selected" : ""
                        }
                        aria-pressed={!controllers && t.id === tab.id}
                        onDoubleClick={() => setEditingTab(t.id)}
                        onClick={() => {
                          setControllers(false);
                          setWorkspace((old) => ({ ...old, activeTab: t.id }));
                        }}
                      >
                        {t.name}
                      </button>
                    )}
                    {workspace.tabs.length > 1 && (
                      <button
                        className="tab-close"
                        aria-label={`Close ${t.name}`}
                        onClick={() =>
                          setWorkspace((old) => {
                            const tabs = old.tabs.filter((x) => x.id !== t.id);
                            return {
                              ...old,
                              tabs,
                              activeTab:
                                old.activeTab === t.id
                                  ? tabs[0].id
                                  : old.activeTab,
                            };
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  aria-label="Add workspace"
                  title="Add workspace"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setControllers(false);
                    setWorkspace((old) => ({
                      ...old,
                      activeTab: id,
                      tabs: [
                        ...old.tabs,
                        {
                          id,
                          name: `Workspace ${old.tabs.length + 1}`,
                          widgets: [],
                        },
                      ],
                    }));
                  }}
                >
                  +
                </button>
                <button
                  className={`controllers-tab ${controllers ? "selected" : ""}`}
                  aria-pressed={controllers}
                  onClick={() => setControllers(true)}
                >
                  Controllers
                </button>
                <span className="tabs-spacer" />
                <button
                  className="icon-button"
                  aria-label="Export"
                  title="Export workspace"
                  onClick={exportWorkspace}
                >
                  <Icon name="export" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Import"
                  title="Import workspace"
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="import" />
                </button>
                <input
                  hidden
                  ref={fileInput}
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      void importWorkspace(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
              </nav>
              {controllers ? (
                <ControllerPanel
                  profiles={workspace.profiles}
                  devices={devices}
                  keyboardPort={workspace.keyboardPort}
                  onKeyboardPort={setKeyboardPort}
                  onClose={() => setControllers(false)}
                  onChange={(profiles) =>
                    setWorkspace((old) => ({ ...old, profiles }))
                  }
                />
              ) : (
                <>
                  <h1 className="sr-only">{tab.name}</h1>
                  <div
                    className="grid-scroll"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      try {
                        const topic = JSON.parse(
                          e.dataTransfer.getData("application/x-nt-topic"),
                        ) as TopicDescriptor;
                        add(topic.name, topic.type);
                      } catch {
                        /* Ignore unsupported drops. */
                      }
                    }}
                  >
                    <Grid
                      key={tab.id}
                      layout={layout}
                      cols={12}
                      rowHeight={38}
                      margin={[12, 12]}
                      draggableHandle=".widget-handle"
                      draggableCancel="button,input,select"
                      onDragStop={updateLayout}
                      onResizeStop={updateLayout}
                      compactType="vertical"
                      isDraggable={!narrowCanvas}
                      isResizable={!narrowCanvas}
                    >
                      {tab.widgets.map((w) => (
                        <div key={w.id}>
                          <Card
                            widget={w}
                            connected={connections.nt}
                            onSettings={showSettings}
                            onRemove={remove}
                            onDuplicate={duplicate}
                          />
                        </div>
                      ))}
                    </Grid>
                    {!tab.widgets.length && (
                      <div className="empty">
                        <h2>
                          {connections.nt
                            ? "No widgets yet"
                            : "Simulation disconnected"}
                        </h2>
                        <p>
                          {connections.nt
                            ? "Click or drag a topic from NetworkTables to add a widget."
                            : "Start your robot simulation and connect its local services."}
                        </p>
                        <div className="empty-actions">
                          <button
                            className="primary"
                            onClick={() => {
                              if (!connections.nt) {
                                setSettingsPage(true);
                                return;
                              }
                              setMobilePanel("topics");
                              setWorkspace((old) => ({
                                ...old,
                                topicsCollapsed: false,
                              }));
                              requestAnimationFrame(() =>
                                document
                                  .querySelector<HTMLInputElement>(
                                    '[aria-label="Filter selectors"]',
                                  )
                                  ?.focus(),
                              );
                            }}
                          >
                            {connections.nt
                              ? "Browse selectors"
                              : "Connection settings"}
                          </button>
                          <button onClick={() => setControllers(true)}>
                            Set up controllers
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}
      {selected && !settingsPage && (
        <WidgetSettings
          widget={selected}
          onClose={() => setSettings(undefined)}
          onSave={(next) => {
            editWidgets((w) =>
              w.map((old) => (old.id === next.id ? next : old)),
            );
            setSettings(undefined);
          }}
        />
      )}
    </div>
  );
}
function ConnectionSettings({
  endpoints,
  onConnect,
}: {
  endpoints: Endpoints;
  onConnect: (endpoints: Endpoints) => Promise<void>;
}) {
  const [draft, setDraft] = useState(endpoints);
  const [connecting, setConnecting] = useState(false);
  useEffect(() => setDraft(endpoints), [endpoints]);
  return (
    <section className="settings-card connection-settings">
      <div className="settings-section-intro">
        <h2>Simulation connection</h2>
        <p>
          Connect to the services running alongside your robot code on this
          computer.
        </p>
      </div>
      <form
        className="settings-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (connecting) return;
          setConnecting(true);
          try {
            await onConnect(draft);
          } finally {
            setConnecting(false);
          }
        }}
      >
        {(["project", "control", "nt"] as const).map((key) => (
          <label key={key}>
            {
              {
                project: "Project folder",
                control: "Robot control endpoint",
                nt: "NetworkTables endpoint",
              }[key]
            }
            <input
              spellCheck={false}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <div className="dialog-actions">
          <button type="submit" disabled={connecting}>
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </section>
  );
}
