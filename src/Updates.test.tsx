// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Updates } from "./Updates";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "0.1.0");
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke
    .mockReset()
    .mockImplementation(async (name: string) =>
      name === "update_status"
        ? { phase: "ready", version: "0.2.0", downloaded: 10 }
        : undefined,
    );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("app updates", () => {
  it("defers replacement while either simulation service is connected", async () => {
    render(<Updates connected={true} save={vi.fn()} />);
    const button = await screen.findByRole("button", {
      name: "Restart to update",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.invoke).not.toHaveBeenCalledWith("prepare_update");
  });
  it("freezes sessions and saves the workspace before installing", async () => {
    const order: string[] = [];
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === "update_status") return { phase: "ready", downloaded: 10 };
      order.push(name);
    });
    render(
      <Updates
        connected={false}
        save={async () => {
          order.push("save");
        }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Restart to update" }),
    );
    await waitFor(() =>
      expect(order).toEqual(["prepare_update", "save", "install_update"]),
    );
  });
  it("aborts replacement when saving fails and unfreezes sessions", async () => {
    render(
      <Updates
        connected={false}
        save={async () => {
          throw Error("disk full");
        }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Restart to update" }),
    );
    await screen.findByRole("alert");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_update");
    expect(mocks.invoke).not.toHaveBeenCalledWith("install_update");
  });
  it("handles a simulation connecting after the button became available", async () => {
    const save = vi.fn();
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === "update_status") return { phase: "ready", downloaded: 10 };
      if (name === "prepare_update")
        throw Error("Stop the simulation before updating Studio");
    });
    render(<Updates connected={false} save={save} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restart to update" }),
    );
    await screen.findByRole("alert");
    expect(save).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("install_update");
    expect(mocks.invoke).not.toHaveBeenCalledWith("cancel_update");
  });
  it("keeps recovery available after installation fails", async () => {
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === "update_status") return { phase: "ready", downloaded: 10 };
      if (name === "install_update") throw Error("permission denied");
    });
    render(<Updates connected={false} save={async () => {}} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restart to update" }),
    );
    await screen.findByRole("alert");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_update");
    fireEvent.click(screen.getByRole("button", { name: "Download installer" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("open_downloads"),
    );
  });
  it("shows offline errors without preventing retry", async () => {
    mocks.invoke.mockResolvedValue({
      phase: "error",
      message: "Offline",
      downloaded: 0,
    });
    render(<Updates connected={false} save={async () => {}} />);
    await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("check_update"),
    );
  });
});
