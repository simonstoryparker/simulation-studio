// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import App from "./App";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  focus: undefined as undefined | ((e: { payload: boolean }) => void),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    native.listeners.set(name, cb);
    return () => native.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (cb: typeof native.focus) => {
      native.focus = cb;
      return () => {
        native.focus = undefined;
      };
    },
    onCloseRequested: async () => () => {},
  }),
}));
vi.mock("react-grid-layout", () => ({
  default: () => null,
  WidthProvider: () => () => null,
}));
vi.mock("./Controller3D", () => ({ default: () => null }));

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "0.1.1");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  native.invoke.mockReset().mockImplementation(async (name: string) => {
    if (name === "bootstrap")
      return {
        endpoints: { project: "Test robot", control: "", nt: "" },
        topics: [],
        values: [],
        devices: [],
        compact: false,
        controlConnected: true,
      };
    if (name === "load_workspace") return null;
    if (name === "update_status") return { phase: "current", downloaded: 0 };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function ready() {
  render(<App />);
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith("report_ready", undefined),
  );
}
async function focus(payload: boolean) {
  await act(async () => {
    native.focus?.({ payload });
  });
}

describe("connection settings", () => {
  it("submits edited endpoints and loads the connected project's workspace", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Studio settings" }));
    fireEvent.change(screen.getByLabelText("Project folder"), {
      target: { value: "/robots/practice" },
    });
    fireEvent.change(screen.getByLabelText("Robot control endpoint"), {
      target: { value: "ws://127.0.0.1:5810" },
    });
    fireEvent.change(screen.getByLabelText("NetworkTables endpoint"), {
      target: { value: "ws://127.0.0.1:5811" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /^Connect$/ }).closest("form")!,
    );
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("connect", {
        endpoints: {
          project: "/robots/practice",
          control: "ws://127.0.0.1:5810",
          nt: "ws://127.0.0.1:5811",
        },
      }),
    );
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("load_workspace", {
        project: "/robots/practice",
      }),
    );
    await screen.findByText("practice", { selector: ".project-title strong" });
  });
});

describe("driver controls", () => {
  it("starts with no alliance station selected and clears a station when clicked again", async () => {
    await ready();
    const stations = within(
      screen.getByRole("group", { name: "Alliance station" }),
    );
    expect(stations.queryByRole("button", { name: "Unknown" })).toBeNull();
    expect(stations.queryAllByRole("button", { pressed: true })).toHaveLength(
      0,
    );
    const red = stations.getByRole("button", { name: "Red station 2" });
    fireEvent.click(red);
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "set_control",
        expect.objectContaining({ enabled: false, alliance: "Red2" }),
      ),
    );
    expect(red.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(red);
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "set_control",
        expect.objectContaining({ enabled: false, alliance: "Unknown" }),
      ),
    );
    expect(stations.queryAllByRole("button", { pressed: true })).toHaveLength(
      0,
    );
    fireEvent.click(stations.getByRole("button", { name: "Blue station 1" }));
    fireEvent.click(stations.getByRole("button", { name: "Red station 3" }));
    expect(stations.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(
      stations
        .getByRole("button", { name: "Red station 3" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it("only offers moving the keyboard on a different port and labels its current port with an icon", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Controllers" }));
    const ports = document.querySelector(".port-list")! as HTMLElement;
    expect(within(ports).getByRole("img", { name: "Keyboard" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keyboard here" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move keyboard here" }),
    ).toBeNull();
    fireEvent.click(
      within(ports).getByRole("button", { name: /Port 1.*Operator/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move keyboard here" }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("set_keyboard_port", {
        port: 1,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Move keyboard here" }),
    ).toBeNull();
  });
  it("shows hot-plugged gamepads and assigns them from the control panel", async () => {
    await ready();
    await act(async () =>
      native.listeners.get("devices")?.({
        payload: [
          { id: "pad-a", name: "Driver controller" },
          { id: "pad-b", name: "Operator controller" },
        ],
      }),
    );
    const driver = screen.getByRole("group", {
      name: "Driver controller port",
    });
    const operator = screen.getByRole("group", {
      name: "Operator controller port",
    });
    fireEvent.click(
      within(driver).getByRole("button", { name: "Port 0: Driver" }),
    );
    await waitFor(() =>
      expect(
        within(driver)
          .getByRole("button", { name: "Port 0: Driver" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(
      within(operator).getByRole("button", { name: "Port 1: Operator" }),
    );
    await waitFor(() =>
      expect(
        within(operator)
          .getByRole("button", { name: "Port 1: Operator" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(
      within(driver).getByRole("button", { name: "Port 1: Operator" }),
    );
    await waitFor(() =>
      expect(
        within(operator)
          .getByRole("button", { name: "Port 0: Driver" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(native.invoke).toHaveBeenLastCalledWith(
      "set_profiles",
      expect.objectContaining({
        profiles: expect.arrayContaining([
          expect.objectContaining({
            name: "Operator",
            source: "gamepad:pad-a",
          }),
          expect.objectContaining({ name: "Driver", source: "gamepad:pad-b" }),
        ]),
      }),
    );
  });
  it("keeps the robot disabled when Full Match is selected and shows its durations", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Full Match" }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "set_control",
        expect.objectContaining({ enabled: false, estop: false, mode: "auto" }),
      ),
    );
    expect(screen.getByText("Full Match durations (seconds)")).toBeTruthy();
    expect(screen.getByLabelText("Disabled transition")).toBeTruthy();
  });
});

describe("compact overlay", () => {
  it("defaults to ports 0/1, dismisses automatic mode, and allows explicit reopening", async () => {
    await ready();
    await focus(false);
    const ports = await screen.findByRole("group", {
      name: "Controller ports and keyboard destination",
    });
    expect(within(ports).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss compact overlay" }),
    );
    await screen.findByRole("button", { name: "Compact" });
    native.invoke.mockClear();
    await focus(false);
    expect(native.invoke).not.toHaveBeenCalledWith(
      "set_compact",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    await screen.findByRole("button", { name: "Dismiss compact overlay" });
    expect(native.invoke).toHaveBeenCalledWith(
      "set_compact",
      expect.objectContaining({ compact: true, width: 560, height: 56 }),
    );
  });
  it("synchronizes native Dock and window-switcher restoration", async () => {
    await ready();
    await focus(false);
    await screen.findByRole("button", { name: "Dismiss compact overlay" });
    await act(async () => {
      native.listeners.get("compact-changed")?.({ payload: false });
    });
    await screen.findByRole("button", { name: "Compact" });
    expect(document.documentElement.classList.contains("compact-window")).toBe(
      false,
    );
  });
  it("fits the native window to the rendered controls", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return {
          width: this.classList.contains("compact-content") ? 452 : 0,
          height: 38,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 452,
          bottom: 38,
          toJSON() {},
        };
      },
    );
    await ready();
    await focus(false);
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("resize_compact", {
        width: 494,
        height: 56,
      }),
    );
  });
  it("keeps first-click controls compact even when no DOM pointer event arrives before focus", async () => {
    await ready();
    await focus(false);
    await screen.findByRole("button", { name: "Dismiss compact overlay" });
    native.invoke.mockClear();
    await focus(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "set_control",
        expect.objectContaining({ enabled: true }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Robot mode" }), {
      target: { value: "auto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "1 Operator" }));
    expect(native.invoke).toHaveBeenCalledWith("set_keyboard_port", {
      port: 1,
    });
    expect(native.invoke).not.toHaveBeenCalledWith(
      "set_compact",
      expect.objectContaining({ compact: false }),
    );
    expect(
      screen.getByRole("button", { name: "Dismiss compact overlay" }),
    ).toBeTruthy();
  });
});

describe("robot state buttons", () => {
  it.each([false, true])(
    "highlights only the confirmed state (compact: %s)",
    async (compact) => {
      await ready();
      if (compact) await focus(false);
      const selected = (name: string) =>
        screen.getByRole("button", { name }).getAttribute("aria-pressed");
      const report = async (enabled: boolean, estop = false) => {
        await act(async () => {
          native.listeners.get("applied")?.({
            payload: {
              state: { enabled, estop, mode: "teleop" },
              joysticks: [],
            },
          });
        });
      };
      expect(selected("Enable")).toBe("false");
      expect(selected("Disable")).toBe("false");
      await report(false);
      expect(selected("Enable")).toBe("false");
      expect(selected("Disable")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Enable" }));
      expect(selected("Enable")).toBe("false");
      expect(selected("Disable")).toBe("true");
      await report(true);
      expect(selected("Enable")).toBe("true");
      expect(selected("Disable")).toBe("false");
      await report(false, true);
      expect(selected("Enable")).toBe("false");
      expect(selected("Disable")).toBe("false");
      await report(true);
      await act(async () => {
        native.listeners.get("connection")?.({
          payload: { service: "control", connected: false },
        });
      });
      expect(selected("Enable")).toBe("false");
      expect(selected("Disable")).toBe("false");
    },
  );
});
