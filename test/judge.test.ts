import { describe, it, expect } from "vitest";
import { fakeJudge, tokenSimilarity, judgeOutputDiff } from "../src/judge.js";
import { diffRun } from "../src/diff.js";
import { normalizeRun } from "../src/snapshot.js";
import type { AgentRun } from "../src/types.js";

function run(output: string): AgentRun {
  return {
    scenario: "s1",
    input: "go",
    steps: [{ tool: "search", args: { q: "x" } }],
    finalOutput: output,
  };
}

describe("tokenSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(tokenSimilarity("hello world", "hello world")).toBe(1);
  });
  it("returns 1 for two empty strings", () => {
    expect(tokenSimilarity("", "")).toBe(1);
  });
  it("is insensitive to case and punctuation", () => {
    expect(tokenSimilarity("Hello, World!", "hello world")).toBe(1);
  });
  it("returns a fraction for partial overlap", () => {
    const s = tokenSimilarity("a b c d", "a b c x");
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });
});

describe("fakeJudge", () => {
  it("calls equivalent for identical canonical forms", async () => {
    const j = fakeJudge();
    const v = await j("Booked flight UA-512.", "booked flight ua-512");
    expect(v.equivalent).toBe(true);
  });

  it("calls equivalent for paraphrases above threshold", async () => {
    const j = fakeJudge(0.5);
    const v = await j(
      "It is 18C and partly cloudy in Paris",
      "It is 18C and cloudy in Paris today",
    );
    expect(v.equivalent).toBe(true);
    expect(v.reason).toMatch(/similar/);
  });

  it("calls not-equivalent for dissimilar outputs", async () => {
    const j = fakeJudge(0.85);
    const v = await j("The capital of France is Paris", "Order shipped today");
    expect(v.equivalent).toBe(false);
  });
});

describe("judgeOutputDiff", () => {
  it("rescues an output-only diff when the judge approves", async () => {
    const snap = normalizeRun(run("It is 18C and partly cloudy in Paris"));
    const diff = diffRun(run("It is 18C and cloudy in Paris today"), snap);
    expect(diff.pass).toBe(false);

    const { diff: rescued, verdict } = await judgeOutputDiff(
      diff,
      snap,
      fakeJudge(0.5),
    );
    expect(verdict?.equivalent).toBe(true);
    expect(rescued.pass).toBe(true);
    expect(rescued.outputDiff).toBeUndefined();
  });

  it("does not rescue when tool calls also changed", async () => {
    const snap = normalizeRun(run("hello"));
    const r = run("hello world entirely different text here now");
    r.steps.push({ tool: "extra", args: {} });
    const diff = diffRun(r, snap);

    const { diff: result } = await judgeOutputDiff(diff, snap, fakeJudge(0.0));
    // step change present -> judge must not flip it to pass
    expect(result.pass).toBe(false);
  });

  it("does not rescue when outputs are too dissimilar", async () => {
    const snap = normalizeRun(run("The weather in Paris is sunny"));
    const diff = diffRun(run("Your order has been cancelled"), snap);
    const { diff: result, verdict } = await judgeOutputDiff(
      diff,
      snap,
      fakeJudge(0.85),
    );
    expect(verdict?.equivalent).toBe(false);
    expect(result.pass).toBe(false);
  });
});
