import { describe, it, expect } from "vitest";
import { deepEqual, diffArgs, diffRun, newScenarioDiff } from "../src/diff.js";
import { normalizeRun } from "../src/snapshot.js";
import type { AgentRun } from "../src/types.js";

function baseRun(): AgentRun {
  return {
    scenario: "s1",
    input: "go",
    steps: [
      { tool: "search", args: { query: "cats", limit: 5 } },
      { tool: "summarize", args: { style: "short" } },
    ],
    finalOutput: "Here is a summary.",
  };
}

describe("deepEqual", () => {
  it("treats key order as equal", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it("detects nested differences", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });
  it("compares arrays positionally", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
  it("distinguishes null and object", () => {
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe("diffArgs", () => {
  it("finds changed scalar fields", () => {
    const d = diffArgs({ a: 1 }, { a: 2 }, "args", []);
    expect(d).toEqual([{ path: "args.a", before: 1, after: 2 }]);
  });
  it("finds added and removed fields", () => {
    const d = diffArgs({ a: 1 }, { b: 2 }, "args", []);
    expect(d).toContainEqual({ path: "args.a", before: 1 });
    expect(d).toContainEqual({ path: "args.b", after: 2 });
  });
  it("honors ignore patterns", () => {
    const d = diffArgs({ a: 1 }, { a: 2 }, "args", ["args.a"]);
    expect(d).toEqual([]);
  });
});

describe("diffRun", () => {
  it("passes on an identical run", () => {
    const snap = normalizeRun(baseRun());
    const diff = diffRun(baseRun(), snap);
    expect(diff.pass).toBe(true);
    expect(diff.stepChanges).toEqual([]);
  });

  it("detects a changed tool argument", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.steps[0].args.query = "dogs";
    const diff = diffRun(run, snap);
    expect(diff.pass).toBe(false);
    expect(diff.stepChanges).toHaveLength(1);
    expect(diff.stepChanges[0].kind).toBe("changed");
    expect(diff.stepChanges[0].argDiffs).toContainEqual({
      path: "args.query",
      before: "cats",
      after: "dogs",
    });
  });

  it("detects an added tool call", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.steps.push({ tool: "translate", args: { lang: "fr" } });
    const diff = diffRun(run, snap);
    expect(diff.stepChanges).toContainEqual(
      expect.objectContaining({ index: 2, tool: "translate", kind: "added" }),
    );
    expect(diff.pass).toBe(false);
  });

  it("detects a removed tool call", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.steps.pop();
    const diff = diffRun(run, snap);
    expect(diff.stepChanges).toContainEqual(
      expect.objectContaining({ index: 1, tool: "summarize", kind: "removed" }),
    );
  });

  it("detects a renamed tool at the same index", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.steps[0].tool = "web_search";
    const diff = diffRun(run, snap);
    const change = diff.stepChanges[0];
    expect(change.toolRenamed).toBe(true);
    expect(change.previousTool).toBe("search");
    expect(change.tool).toBe("web_search");
  });

  it("detects an output change", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.finalOutput = "A completely different summary.";
    const diff = diffRun(run, snap);
    expect(diff.outputDiff).toBeDefined();
    expect(diff.outputDiff?.after).toBe("A completely different summary.");
    expect(diff.pass).toBe(false);
  });

  it("detects an input change", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.input = "stop";
    const diff = diffRun(run, snap);
    expect(diff.inputDiff).toBeDefined();
    expect(diff.pass).toBe(false);
  });

  it("exact mode fails on an ignored field", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.steps[1].args.style = "long";
    const diff = diffRun(run, snap, {
      mode: "exact",
      ignore: ["args.style"],
    });
    // ignore is inactive in exact mode
    expect(diff.pass).toBe(false);
  });

  it("tolerant mode ignores configured fields", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.steps[1].args.style = "long";
    const diff = diffRun(run, snap, {
      mode: "tolerant",
      ignore: ["args.style"],
    });
    expect(diff.pass).toBe(true);
  });

  it("tolerant mode can ignore the final output", () => {
    const snap = normalizeRun(baseRun());
    const run = baseRun();
    run.finalOutput = "totally different";
    const diff = diffRun(run, snap, {
      mode: "tolerant",
      ignore: ["finalOutput"],
    });
    expect(diff.pass).toBe(true);
  });

  it("applies redaction before comparing", () => {
    const run1 = baseRun();
    run1.steps[0].meta = { latencyMs: 10 };
    const snap = normalizeRun(run1, { redact: ["steps.*.meta.latencyMs"] });

    const run2 = baseRun();
    run2.steps[0].meta = { latencyMs: 999 };
    const diff = diffRun(run2, snap, { redact: ["steps.*.meta.latencyMs"] });
    expect(diff.pass).toBe(true);
  });
});

describe("newScenarioDiff", () => {
  it("marks brand-new scenarios as failing and isNew", () => {
    const diff = newScenarioDiff(baseRun(), "exact");
    expect(diff.isNew).toBe(true);
    expect(diff.pass).toBe(false);
  });
});
