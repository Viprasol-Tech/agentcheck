/**
 * Snapshot serialization, normalization and disk I/O.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRun, NormalizeOptions, Snapshot, ToolCall } from "./types.js";

const REDACTED = "[REDACTED]";

/** Returns true if the value is a plain (non-array, non-null) object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Recursively returns a copy of `value` with object keys sorted alphabetically
 * so that serialization is stable regardless of insertion order.
 */
export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeysDeep(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Splits a dotted path into segments. A `*` segment is a single-level wildcard.
 */
function pathSegments(path: string): string[] {
  return path.split(".").filter((s) => s.length > 0);
}

/**
 * Redacts (in place, on a cloned value) every location in `root` matching the
 * dotted `path`. Array indices are matched either by explicit number or by `*`.
 */
function applyRedaction(root: unknown, segments: string[]): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;

  if (Array.isArray(root)) {
    if (head === "*") {
      for (const item of root) {
        if (rest.length === 0) {
          // Cannot redact an array element wholesale via index here; only
          // object fields are redactable. A trailing `*` on an array is a no-op.
          continue;
        }
        applyRedaction(item, rest);
      }
    } else {
      const idx = Number(head);
      if (Number.isInteger(idx) && idx >= 0 && idx < root.length) {
        if (rest.length === 0) {
          root[idx] = REDACTED;
        } else {
          applyRedaction(root[idx], rest);
        }
      }
    }
    return;
  }

  if (isPlainObject(root)) {
    const keys = head === "*" ? Object.keys(root) : [head];
    for (const key of keys) {
      if (!(key in root)) continue;
      if (rest.length === 0) {
        root[key] = REDACTED;
      } else {
        applyRedaction(root[key], rest);
      }
    }
  }
}

/** Collapses internal whitespace and trims a string. */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Deep clone using structured serialization (snapshots are JSON-safe). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Normalizes an {@link AgentRun} into a stable {@link Snapshot}:
 * - clones the run so the input is never mutated,
 * - applies every redaction path,
 * - optionally normalizes whitespace in the final output,
 * - sorts all object keys deeply.
 */
export function normalizeRun(
  run: AgentRun,
  opts: NormalizeOptions = {},
): Snapshot {
  const working = clone(run);

  for (const path of opts.redact ?? []) {
    applyRedaction(working, pathSegments(path));
  }

  let finalOutput = working.finalOutput;
  if (opts.normalizeWhitespace) {
    finalOutput = collapseWhitespace(finalOutput);
  }

  const steps: ToolCall[] = working.steps.map((step) => {
    const normalized: ToolCall = {
      tool: step.tool,
      args: sortKeysDeep(step.args ?? {}),
    };
    if (step.result !== undefined) normalized.result = sortKeysDeep(step.result);
    if (step.meta !== undefined && Object.keys(step.meta).length > 0) {
      normalized.meta = sortKeysDeep(step.meta);
    }
    return normalized;
  });

  const snapshot: Snapshot = {
    version: 1,
    scenario: working.scenario,
    input: opts.normalizeWhitespace
      ? collapseWhitespace(working.input)
      : working.input,
    steps,
    finalOutput,
  };

  if (working.meta !== undefined && Object.keys(working.meta).length > 0) {
    snapshot.meta = sortKeysDeep(working.meta);
  }

  return snapshot;
}

/** Serializes a snapshot to canonical, stable, pretty-printed JSON. */
export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(sortKeysDeep(snapshot), null, 2) + "\n";
}

/** Parses a snapshot from its serialized JSON form. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (data.version !== 1) {
    throw new Error(
      `Unsupported snapshot version: ${String((data as { version?: unknown }).version)}`,
    );
  }
  return data;
}

/** Returns the absolute path for a scenario's snapshot file. */
export function snapshotPath(dir: string, fileName: string): string {
  return join(dir, fileName);
}

/** Returns true if a snapshot file exists. */
export function snapshotExists(dir: string, fileName: string): boolean {
  return existsSync(snapshotPath(dir, fileName));
}

/** Loads and parses a stored snapshot from disk. */
export function loadSnapshot(dir: string, fileName: string): Snapshot {
  const text = readFileSync(snapshotPath(dir, fileName), "utf8");
  return parseSnapshot(text);
}

/** Saves a snapshot to disk, creating the directory if needed. */
export function saveSnapshot(
  dir: string,
  fileName: string,
  snapshot: Snapshot,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(snapshotPath(dir, fileName), serializeSnapshot(snapshot), "utf8");
}
