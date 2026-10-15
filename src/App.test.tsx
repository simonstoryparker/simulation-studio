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
        screen
          .getByRole("button", { name })
          .getAttribute("aria-pressed");
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
      fireEvent.click(
        screen.getByRole("button", { name: "Enable" }),
      );
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
