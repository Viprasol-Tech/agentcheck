import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeRun,
  serializeSnapshot,
  parseSnapshot,
  sortKeysDeep,
  saveSnapshot,
  loadSnapshot,
  snapshotExists,
} from "../src/snapshot.js";
import type { AgentRun } from "../src/types.js";

function sampleRun(): AgentRun {
  return {
    scenario: "s1",
    input: "do the thing",
    meta: { runId: "abc123", startedAt: "2025-01-01T00:00:00Z" },
    steps: [
      {
        tool: "search",
        args: { query: "hello", limit: 5 },
        meta: { latencyMs: 42, traceId: "t-1" },
      },
    ],
    finalOutput: "done",
  };
}

describe("sortKeysDeep", () => {
  it("sorts nested object keys alphabetically", () => {
    const out = sortKeysDeep({ b: 1, a: { d: 2, c: 3 } });
    expect(JSON.stringify(out)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("recurses into arrays", () => {
    const out = sortKeysDeep([{ z: 1, a: 2 }]);
    expect(JSON.stringify(out)).toBe('[{"a":2,"z":1}]');
  });

  it("leaves primitives unchanged", () => {
    expect(sortKeysDeep(5)).toBe(5);
    expect(sortKeysDeep("x")).toBe("x");
    expect(sortKeysDeep(null)).toBe(null);
  });
});

describe("normalizeRun", () => {
  it("does not mutate the input run", () => {
    const run = sampleRun();
    normalizeRun(run, { redact: ["meta.runId"] });
    expect(run.meta?.runId).toBe("abc123");
  });

  it("redacts a top-level meta field", () => {
    const snap = normalizeRun(sampleRun(), { redact: ["meta.runId"] });
    expect(snap.meta?.runId).toBe("[REDACTED]");
    expect(snap.meta?.startedAt).toBe("2025-01-01T00:00:00Z");
  });

  it("redacts via wildcard inside steps", () => {
    const snap = normalizeRun(sampleRun(), {
      redact: ["steps.*.meta.latencyMs"],
    });
    expect(snap.steps[0].meta?.latencyMs).toBe("[REDACTED]");
    expect(snap.steps[0].meta?.traceId).toBe("t-1");
  });

  it("redacts an explicit array index", () => {
    const snap = normalizeRun(sampleRun(), {
      redact: ["steps.0.meta.traceId"],
    });
    expect(snap.steps[0].meta?.traceId).toBe("[REDACTED]");
  });

  it("sorts arg keys for stability", () => {
    const run = sampleRun();
    run.steps[0].args = { z: 1, a: 2, m: 3 };
    const snap = normalizeRun(run);
    expect(Object.keys(snap.steps[0].args)).toEqual(["a", "m", "z"]);
  });

  it("collapses whitespace when requested", () => {
    const run = sampleRun();
    run.finalOutput = "  hello   world\n\n";
    const snap = normalizeRun(run, { normalizeWhitespace: true });
    expect(snap.finalOutput).toBe("hello world");
  });

  it("omits empty meta", () => {
    const run = sampleRun();
    delete run.meta;
    run.steps[0].meta = {};
    const snap = normalizeRun(run);
    expect(snap.meta).toBeUndefined();
    expect(snap.steps[0].meta).toBeUndefined();
  });

  it("sets version to 1", () => {
    expect(normalizeRun(sampleRun()).version).toBe(1);
  });
});

describe("serialize/parse", () => {
  it("round-trips a snapshot", () => {
    const snap = normalizeRun(sampleRun(), { redact: ["meta.runId"] });
    const text = serializeSnapshot(snap);
    const back = parseSnapshot(text);
    expect(back).toEqual(snap);
  });

  it("produces stable output regardless of key order", () => {
    const a = normalizeRun(sampleRun());
    const b = normalizeRun({
      ...sampleRun(),
      meta: { startedAt: "2025-01-01T00:00:00Z", runId: "abc123" },
    });
    expect(serializeSnapshot(a)).toBe(serializeSnapshot(b));
  });

  it("ends serialized output with a trailing newline", () => {
    expect(serializeSnapshot(normalizeRun(sampleRun())).endsWith("\n")).toBe(
      true,
    );
  });

  it("rejects unsupported versions", () => {
    expect(() => parseSnapshot('{"version":2}')).toThrow(/version/i);
  });
});

describe("disk I/O", () => {
  it("saves, detects, and loads a snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcheck-"));
    try {
      const snap = normalizeRun(sampleRun(), { redact: ["meta.runId"] });
      expect(snapshotExists(dir, "s1.json")).toBe(false);
      saveSnapshot(dir, "s1.json", snap);
      expect(snapshotExists(dir, "s1.json")).toBe(true);
      expect(loadSnapshot(dir, "s1.json")).toEqual(snap);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
