import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseConfig,
  snapshotFileFor,
  resolveConfigPath,
  loadConfig,
} from "../src/scenarios.js";

const VALID = `
agent: ./agent.ts
snapshotDir: snaps
mode: tolerant
redact:
  - meta.runId
ignore:
  - args.debug
scenarios:
  - name: greet
    input: say hi
  - name: book
    input: book a flight
    snapshot: booking.json
`;

describe("parseConfig", () => {
  it("parses a valid config", () => {
    const cfg = parseConfig(VALID);
    expect(cfg.mode).toBe("tolerant");
    expect(cfg.snapshotDir).toBe("snaps");
    expect(cfg.agent).toBe("./agent.ts");
    expect(cfg.redact).toEqual(["meta.runId"]);
    expect(cfg.ignore).toEqual(["args.debug"]);
    expect(cfg.scenarios).toHaveLength(2);
  });

  it("defaults mode to exact and snapshotDir to .agentcheck/snapshots", () => {
    const cfg = parseConfig("scenarios:\n  - name: a\n    input: x\n");
    expect(cfg.mode).toBe("exact");
    expect(cfg.snapshotDir).toBe(".agentcheck/snapshots");
  });

  it("rejects an empty document", () => {
    expect(() => parseConfig("")).toThrow(/empty/i);
  });

  it("rejects an invalid mode", () => {
    expect(() =>
      parseConfig("mode: fuzzy\nscenarios:\n  - name: a\n    input: x\n"),
    ).toThrow(/mode/);
  });

  it("rejects missing scenarios", () => {
    expect(() => parseConfig("mode: exact\n")).toThrow(/scenarios/);
  });

  it("rejects a scenario without a name", () => {
    expect(() =>
      parseConfig("scenarios:\n  - input: x\n"),
    ).toThrow(/name is required/);
  });

  it("rejects a non-string input", () => {
    expect(() =>
      parseConfig("scenarios:\n  - name: a\n    input: 5\n"),
    ).toThrow(/input must be a string/);
  });

  it("rejects duplicate scenario names", () => {
    expect(() =>
      parseConfig(
        "scenarios:\n  - name: a\n    input: x\n  - name: a\n    input: y\n",
      ),
    ).toThrow(/duplicate/);
  });

  it("rejects non-list redact", () => {
    expect(() =>
      parseConfig("redact: nope\nscenarios:\n  - name: a\n    input: x\n"),
    ).toThrow(/redact/);
  });
});

describe("snapshotFileFor", () => {
  it("defaults to <name>.json", () => {
    expect(snapshotFileFor({ name: "greet", input: "" })).toBe("greet.json");
  });
  it("sanitizes unsafe characters", () => {
    expect(snapshotFileFor({ name: "a/b c", input: "" })).toBe("a_b_c.json");
  });
  it("uses the explicit snapshot name", () => {
    expect(
      snapshotFileFor({ name: "x", input: "", snapshot: "custom.json" }),
    ).toBe("custom.json");
  });
});

describe("loadConfig / resolveConfigPath", () => {
  it("finds agentcheck.yaml inside a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcheck-cfg-"));
    try {
      writeFileSync(join(dir, "agentcheck.yaml"), VALID, "utf8");
      const path = resolveConfigPath(dir);
      expect(path.endsWith("agentcheck.yaml")).toBe(true);

      const loaded = loadConfig(dir);
      expect(loaded.config.scenarios).toHaveLength(2);
      expect(loaded.snapshotDir).toBe(join(dir, "snaps"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when no config is found", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcheck-empty-"));
    try {
      expect(() => resolveConfigPath(dir)).toThrow(/No agentcheck.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
