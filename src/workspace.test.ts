import { describe, it, expect } from "vitest";
import {
  emptyWorkspace,
  validateWorkspace,
  parseValue,
  folderCandidates,
  createWidget,
} from "./workspace";
import type { WidgetInstance } from "./types";
describe("generic workspace", () => {
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
    w.overlay.width = 500;
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
