import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
import { applyTelemetry, getTopic, getValue, getChoosers } from "./store";
import type { TopicDescriptor } from "./types";
const topic: TopicDescriptor = {
  id: 1,
  name: "/Generic/value",
  type: "int",
  properties: {},
};
beforeEach(() =>
  applyTelemetry({ lifecycle: [{ method: "reset", topics: [] }], values: [] }),
);
describe("topic store", () => {
  it("keeps full integer strings and rejects older values", () => {
    applyTelemetry({
      lifecycle: [{ method: "announce", topic }],
      values: [
        {
          id: 1,
          timestamp: 20,
          value: { data: "9007199254740993", truncated: false },
        },
      ],
    });
    applyTelemetry({
      lifecycle: [],
      values: [
        { id: 1, timestamp: 10, value: { data: "0", truncated: false } },
      ],
    });
    expect(getValue(topic.name)?.value.data).toBe("9007199254740993");
  });
  it("clears data when a topic disappears or changes type", () => {
    applyTelemetry({
      lifecycle: [{ method: "announce", topic }],
      values: [
        { id: 1, timestamp: 1, value: { data: "123", truncated: false } },
      ],
    });
    applyTelemetry({
      lifecycle: [{ method: "announce", topic: { ...topic, type: "boolean" } }],
      values: [],
    });
    expect(getValue(topic.name)).toBeUndefined();
    applyTelemetry({
      lifecycle: [{ method: "unannounce", id: 1 }],
      values: [],
    });
    expect(getTopic(topic.name)).toBeUndefined();
  });
  it("recognizes chooser metadata at arbitrary paths", () => {
    applyTelemetry({
      lifecycle: [
        {
          method: "announce",
          topic: { ...topic, name: "/Unrelated/Nested/.type", type: "string" },
        },
      ],
      values: [
        {
          id: 1,
          timestamp: 1,
          value: { data: "String Chooser", truncated: false },
        },
      ],
    });
    expect(getChoosers().has("/Unrelated/Nested")).toBe(true);
  });
  it("clears stale values after reconnecting", () => {
    applyTelemetry({
      lifecycle: [{ method: "announce", topic }],
      values: [
        { id: 1, timestamp: 2, value: { data: "123", truncated: false } },
      ],
    });
    applyTelemetry({
      lifecycle: [{ method: "reset", topics: [topic] }],
      values: [],
    });
    expect(getValue(topic.name)).toBeUndefined();
  });
});
