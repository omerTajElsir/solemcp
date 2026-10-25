import type { Clients, Config, SyncState } from "@solemcp/schema";

export type MergeResult = Config | { conflict: true };

/**
 * Three-way merge of Config documents.
 * Disjoint connector / project / client-key edits merge.
 * Divergent edits to the same id or client key conflict.
 * Identical edits on both sides are not conflicts.
 */
export function mergeConfig(base: Config, local: Config, other: Config): MergeResult {
  const connectors = mergeById(base.connectors, local.connectors, other.connectors);
  if (connectors === null) return { conflict: true };

  const projects = mergeById(base.projects, local.projects, other.projects);
  if (projects === null) return { conflict: true };

  const clients = mergeClients(base.clients, local.clients, other.clients);
  if (clients === null) return { conflict: true };

  const sync = mergeSync(base.sync, local.sync, other.sync);
  if (sync === null) return { conflict: true };

  return {
    schemaVersion: 1,
    connectors,
    projects,
    clients,
    sync,
  };
}

function mergeById<T extends { id: string }>(
  base: T[],
  local: T[],
  other: T[],
): T[] | null {
  const baseMap = indexById(base);
  const localMap = indexById(local);
  const otherMap = indexById(other);
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...otherMap.keys()]);
  const out: T[] = [];

  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const o = otherMap.get(id);
    const localChanged = !deepEqual(b, l);
    const otherChanged = !deepEqual(b, o);

    if (localChanged && otherChanged) {
      if (deepEqual(l, o)) {
        if (l !== undefined) out.push(l);
        continue;
      }
      return null;
    }
    if (localChanged) {
      if (l !== undefined) out.push(l);
      continue;
    }
    if (otherChanged) {
      if (o !== undefined) out.push(o);
      continue;
    }
    if (b !== undefined) out.push(b);
  }

  return out;
}

function mergeClients(base: Clients, local: Clients, other: Clients): Clients | null {
  const keys = ["cursor", "claude-code", "codex"] as const;
  const out = { ...base };

  for (const key of keys) {
    const b = base[key];
    const l = local[key];
    const o = other[key];
    const localChanged = !deepEqual(b, l);
    const otherChanged = !deepEqual(b, o);

    if (localChanged && otherChanged) {
      if (deepEqual(l, o)) {
        out[key] = l as never;
        continue;
      }
      return null;
    }
    if (localChanged) out[key] = l as never;
    else if (otherChanged) out[key] = o as never;
  }

  return out;
}

function mergeSync(base: SyncState, local: SyncState, other: SyncState): SyncState | null {
  const localChanged = !deepEqual(base, local);
  const otherChanged = !deepEqual(base, other);
  if (localChanged && otherChanged) {
    if (deepEqual(local, other)) return local;
    return null;
  }
  if (localChanged) return local;
  if (otherChanged) return other;
  return base;
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.id, item);
  return map;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = sortKeys(record[key]);
  }
  return out;
}
