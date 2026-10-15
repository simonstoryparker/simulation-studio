import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import type { TelemetryBatch, TopicDescriptor, TopicValue } from "./types";
const topics = new Map<string, TopicDescriptor>(),
  ids = new Map<number, string>(),
  values = new Map<string, TopicValue>();
const received = new Map<string, TopicValue>();
const listeners = new Map<string, Set<() => void>>(),
  catalogListeners = new Set<() => void>();
let catalog: TopicDescriptor[] = [],
  choosers = new Set<string>();
export function applyTelemetry(batch: TelemetryBatch) {
  const changed = new Set<string>();
  let metadata = false;
  for (const event of batch.lifecycle) {
    metadata = true;
    if (event.method === "reset") {
      for (const name of topics.keys()) changed.add(name);
      topics.clear();
      ids.clear();
      values.clear();
      received.clear();
      for (const topic of event.topics) {
        topics.set(topic.name, topic);
        ids.set(topic.id, topic.name);
      }
    }
    if (event.method === "announce") {
      const oldName = ids.get(event.topic.id);
      if (oldName && oldName !== event.topic.name) {
        topics.delete(oldName);
        values.delete(oldName);
        received.delete(oldName);
        changed.add(oldName);
      }
      const old = topics.get(event.topic.name);
      if (old && old.type !== event.topic.type) {
        values.delete(event.topic.name);
        received.delete(event.topic.name);
      }
      topics.set(event.topic.name, event.topic);
      ids.set(event.topic.id, event.topic.name);
      changed.add(event.topic.name);
    }
    if (event.method === "unannounce") {
      const name = ids.get(event.id);
      if (name) {
        topics.delete(name);
        values.delete(name);
        received.delete(name);
        ids.delete(event.id);
        changed.add(name);
      }
    }
  }
  for (const update of batch.values) {
    const name = ids.get(update.id);
    if (!name) continue;
    const old = values.get(name);
    if (old && old.timestamp > update.timestamp) continue;
    values.set(name, update);
    if (update.origin !== "published") received.set(name, update);
    changed.add(name);
    if (name.endsWith("/.type")) metadata = true;
  }
  if (metadata) {
    catalog = [...topics.values()].sort((a, b) => a.name.localeCompare(b.name));
    choosers = new Set(
      catalog
        .filter(
          (t) =>
            t.name.endsWith("/.type") &&
            values.get(t.name)?.value.data === "String Chooser",
        )
        .map((t) => t.name.slice(0, -6)),
    );
    catalogListeners.forEach((fn) => fn());
  }
  for (const name of changed) listeners.get(name)?.forEach((fn) => fn());
}
export function getTopic(name: string) {
  return topics.get(name);
}
export function getValue(name: string) {
  return values.get(name);
}
export function getChoosers() {
  return choosers;
}
export function useCatalog() {
  return useSyncExternalStore(
    (fn) => {
      catalogListeners.add(fn);
      return () => {
        catalogListeners.delete(fn);
      };
    },
    () => catalog,
  );
}
export function useTopic(name: string) {
  return useSyncExternalStore(
    (fn) => {
      const list = listeners.get(name) ?? new Set();
      listeners.set(name, list);
      list.add(fn);
      return () => {
        list.delete(fn);
        if (!list.size) listeners.delete(name);
      };
    },
    () => values.get(name),
  );
}
const references = new Map<string, number>();
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const name of values.keys()) {
      if (!references.has(name) && !name.endsWith("/.type")) {
        values.delete(name);
        received.delete(name);
      }
    }
    void invoke("subscribe", { names: [...references.keys()] }).catch(
      console.error,
    );
  });
}
export function useSubscriptions(names: string[]) {
  const key = JSON.stringify(names);
  useEffect(() => {
    const parsed = JSON.parse(key) as string[];
    for (const name of parsed)
      references.set(name, (references.get(name) ?? 0) + 1);
    schedule();
    return () => {
      for (const name of parsed) {
        const count = (references.get(name) ?? 1) - 1;
        if (count) references.set(name, count);
        else references.delete(name);
      }
      schedule();
    };
  }, [key]);
}

import type { Joystick } from "./types";
let sticks: Joystick[] = [];
const stickListeners = new Set<() => void>();
export function updateSticks(next: Joystick[]) {
  sticks = next;
  stickListeners.forEach((fn) => fn());
}
export function useSticks() {
  return useSyncExternalStore(
    (fn) => {
      stickListeners.add(fn);
      return () => {
        stickListeners.delete(fn);
      };
    },
    () => sticks,
  );
}

export function useDescriptor(name: string) {
  return useSyncExternalStore(
    (fn) => {
      const list = listeners.get(name) ?? new Set();
      listeners.set(name, list);
      list.add(fn);
      return () => {
        list.delete(fn);
        if (!list.size) listeners.delete(name);
      };
    },
    () => topics.get(name),
  );
}
export function useReceived(name: string) {
  return useSyncExternalStore(
    (fn) => {
      const list = listeners.get(name) ?? new Set();
      listeners.set(name, list);
      list.add(fn);
      return () => {
        list.delete(fn);
        if (!list.size) listeners.delete(name);
      };
    },
    () => received.get(name),
  );
}
