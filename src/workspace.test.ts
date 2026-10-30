import { describe, it, expect } from "vitest";
import {
  emptyWorkspace,
  validateWorkspace,
  parseValue,
  folderCandidates,
  createWidget,
  controlCandidates,
  assignController,
} from "./workspace";
import type { WidgetInstance } from "./types";
describe("generic workspace", () => {
  it("offers editable controls and one entry per chooser, excluding raw data and metadata", () => {
    const topics = [
      { name: "/Robot/enabled", type: "boolean" },
      { name: "/Robot/target", type: "double" },
      { name: "/Robot/pose", type: "struct:Pose2d" },
      { name: "/Robot/.type", type: "string" },
      { name: "/Auto/.type", type: "string" },
      { name: "/Auto/options", type: "string[]" },
      { name: "/Auto/selected", type: "string" },
    ].map((topic, id) => ({ ...topic, id, properties: {} }));
    expect(
      controlCandidates("/", topics, new Set(["/Auto"]), []).map(
        (topic) => topic.name,
      ),
    ).toEqual(["/Auto", "/Robot/enabled", "/Robot/target"]);
  });
  it("moves and swaps connected controllers without losing port bindings or duplicating a device", () => {
    const { profiles } = emptyWorkspace();
    profiles[0].source = "gamepad:driver";
    profiles[1].source = "gamepad:operator";
    const swapped = assignController(profiles, "driver", 1);
    expect(swapped.map((profile) => profile.source)).toEqual([
      "gamepad:operator",
      "gamepad:driver",
      "none",
      "none",
      "none",
      "none",
    ]);
    expect(swapped[0].axes).toEqual(profiles[0].axes);
    expect(swapped[1].name).toBe("Operator");
    const moved = assignController(swapped, "driver", 4);
    expect(moved[1].source).toBe("none");
    expect(moved[4].source).toBe("gamepad:driver");
    expect(profiles[0].source).toBe("gamepad:driver");
  });
  it("round trips and rejects malformed widgets", () => {
    const w = emptyWorkspace();
    expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
    w.tabs[0].widgets.push({ ...createWidget("/a", "boolean", []), w: -1 });
    expect(() => validateWorkspace(w)).toThrow();
  });
  it("migrates v1 keyboard assignments and strips saved write permissions", () => {
    const w = emptyWorkspace();
    const first = w.profiles[1];
    first.source = "keyboard";
    w.profiles[3].source = "keyboard";
    w.profiles[2].source = "gamepad:controller-a";
    w.tabs[0].widgets.push({
      ...createWidget("/editable", "boolean", []),
      editable: false,
    } as unknown as WidgetInstance);
    w.tabs[0].widgets.push({
      ...createWidget("/readout", "double", []),
      kind: "readout",
      editable: true,
    } as unknown as WidgetInstance);
    const legacy = {
      ...w,
      version: 1,
      keyboardPort: undefined,
      topicsCollapsed: undefined,
      matchDurations: undefined,
      overlay: undefined,
    };
    const migrated = validateWorkspace(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.keyboardPort).toBe(1);
    expect(migrated.profiles[1].source).toBe("none");
    expect(migrated.profiles[2].source).toBe("gamepad:controller-a");
    expect(migrated.profiles[3].source).toBe("none");
    expect(Object.hasOwn(migrated.tabs[0].widgets[0], "editable")).toBe(false);
    expect(Object.hasOwn(migrated.tabs[0].widgets[1], "editable")).toBe(false);
    expect(migrated.matchDurations).toEqual({
      auto: 20,
      transition: 3,
      teleop: 140,
    });
  });
  it("persists overlay order and validates destination and durations", () => {
    const w = emptyWorkspace();
    w.overlay.topics = ["/Drive/left", "/Drive/right"];
    w.overlay.width = 600;
    w.overlay.height = 260;
    w.overlay.x = 24;
    w.overlay.y = 80;
    expect(validateWorkspace(JSON.parse(JSON.stringify(w))).overlay).toEqual(
      w.overlay,
    );
    expect(() => validateWorkspace({ ...w, keyboardPort: 6 })).toThrow();
    expect(() =>
      validateWorkspace({
        ...w,
        matchDurations: { auto: -1, transition: 3, teleop: 140 },
      }),
    ).toThrow();
  });
  it("upgrades the original overlay bounds and accepts a short pill", () => {
    const w = emptyWorkspace();
    expect(w.overlay.width).toBe(560);
    expect(w.overlay.height).toBe(56);
    w.overlay.width = 320;
    w.overlay.height = 180;
    expect(validateWorkspace(w).overlay).toMatchObject({
      width: 560,
      height: 56,
    });
    w.overlay.width = 720;
    w.overlay.height = 88;
    expect(validateWorkspace(w).overlay).toMatchObject({
      width: 560,
      height: 56,
    });
    w.overlay.height = 56;
    expect(validateWorkspace(w).overlay.height).toBe(56);
    w.overlay.height = 55;
    expect(() => validateWorkspace(w)).toThrow();
  });
  it("preserves int64 precision and validates writes", () => {
    expect(parseValue("int", "9223372036854775807")).toBe(
      "9223372036854775807",
    );
    expect(() => parseValue("int", "9223372036854775808")).toThrow();
    expect(parseValue("int[]", '["9007199254740993"]')).toEqual([
      "9007199254740993",
    ]);
    expect(() => parseValue("double", "")).toThrow();
  });
  it("expands nested folders, groups choosers and skips duplicates", () => {
    const topics = [
      "/Any/flag",
      "/Any/nested/value",
      "/Any/choice/.type",
      "/Any/choice/options",
      "/Other/x",
    ].map((name, id) => ({ name, id, type: "boolean", properties: {} }));
    const existing = [createWidget("/Any/flag", "boolean", [])];
    expect(
      folderCandidates("/Any", topics, new Set(["/Any/choice"]), existing).map(
        (t) => t.name,
      ),
    ).toEqual(["/Any/choice", "/Any/nested/value"]);
  });
});
