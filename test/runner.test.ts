import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScenarios, type AgentRunner } from "../src/runner.js";
import {
  renderReportText,
  renderReportMarkdown,
  renderDiffText,
} from "../src/report.js";
import { fakeJudge } from "../src/judge.js";
import { snapshotExists } from "../src/snapshot.js";
import type { AgentcheckConfig, AgentRun, ScenarioDef } from "../src/types.js";

function config(overrides: Partial<AgentcheckConfig> = {}): AgentcheckConfig {
  return {
    snapshotDir: ".agentcheck/snapshots",
    mode: "tolerant",
    redact: ["meta.runId"],
    ignore: [],
    scenarios: [
      { name: "alpha", input: "do alpha" },
      { name: "beta", input: "do beta" },
    ],
    ...overrides,
  };
}

function makeAgent(mutate?: (def: ScenarioDef, run: AgentRun) => void): AgentRunner {
  return (def: ScenarioDef): AgentRun => {
    const run: AgentRun = {
      scenario: def.name,
      input: def.input,
      meta: { runId: Math.random().toString(36) },
      steps: [{ tool: "search", args: { query: def.name } }],
      finalOutput: `result for ${def.name}`,
    };
    mutate?.(def, run);
    return run;
  };
}

function withTmp(fn: (dir: string) => Promise<void> | void) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcheck-run-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("runScenarios", () => {
  it(
    "reports new scenarios when no snapshots exist",
    withTmp(async (dir) => {
      const report = await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
      });
      expect(report.ok).toBe(false);
      expect(report.results.every((r) => r.diff.isNew)).toBe(true);
    }),
  );

  it(
    "update mode writes snapshots and passes",
    withTmp(async (dir) => {
      const report = await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
        update: true,
      });
      expect(report.ok).toBe(true);
      expect(snapshotExists(dir, "alpha.json")).toBe(true);
      expect(snapshotExists(dir, "beta.json")).toBe(true);
    }),
  );

  it(
    "passes when a re-run matches the snapshot (redacted volatile field)",
    withTmp(async (dir) => {
      await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
        update: true,
      });
      const report = await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(), // new random runId each time, but it's redacted
      });
      expect(report.ok).toBe(true);
      expect(report.passed).toBe(2);
      expect(report.failed).toBe(0);
    }),
  );

  it(
    "fails when a tool argument regresses",
    withTmp(async (dir) => {
      await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
        update: true,
      });
      const report = await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent((def, run) => {
          if (def.name === "beta") run.steps[0].args.query = "TAMPERED";
        }),
      });
      expect(report.ok).toBe(false);
      expect(report.passed).toBe(1);
      expect(report.failed).toBe(1);
      const beta = report.results.find((r) => r.scenario === "beta")!;
      expect(beta.diff.stepChanges[0].argDiffs).toContainEqual({
        path: "args.query",
        before: "beta",
        after: "TAMPERED",
      });
    }),
  );

  it(
    "uses the judge to rescue an output-only paraphrase",
    withTmp(async (dir) => {
      const cfg = config({ scenarios: [{ name: "alpha", input: "do alpha" }] });
      await runScenarios({
        config: cfg,
        snapshotDir: dir,
        agent: makeAgent(),
        update: true,
      });
      const reportNoJudge = await runScenarios({
        config: cfg,
        snapshotDir: dir,
        agent: makeAgent((_def, run) => {
          run.finalOutput = "result for alpha indeed";
        }),
      });
      expect(reportNoJudge.ok).toBe(false);

      const reportJudge = await runScenarios({
        config: cfg,
        snapshotDir: dir,
        agent: makeAgent((_def, run) => {
          run.finalOutput = "result for alpha indeed";
        }),
        judge: fakeJudge(0.5),
      });
      expect(reportJudge.ok).toBe(true);
    }),
  );
});

describe("report rendering", () => {
  it(
    "produces a PASS text report",
    withTmp(async (dir) => {
      await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
        update: true,
      });
      const report = await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
      });
      const text = renderReportText(report);
      expect(text).toContain("RESULT: PASS");
      expect(text).toContain("2 passed, 0 failed");
    }),
  );

  it(
    "produces a FAIL markdown report with a diff block",
    withTmp(async (dir) => {
      await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent(),
        update: true,
      });
      const report = await runScenarios({
        config: config(),
        snapshotDir: dir,
        agent: makeAgent((def, run) => {
          if (def.name === "alpha") run.steps[0].args.query = "X";
        }),
      });
      const md = renderReportMarkdown(report);
      expect(md).toContain("## agentcheck");
      expect(md).toContain("FAIL");
      expect(md).toContain("| Scenario | Result | Details |");
      expect(md).toContain("```diff");
    }),
  );

  it("renders an added/removed/changed step in text", () => {
    const text = renderDiffText({
      scenario: "s",
      pass: false,
      mode: "exact",
      isNew: false,
      stepChanges: [
        { index: 0, tool: "a", kind: "added" },
        { index: 1, tool: "b", kind: "removed" },
        {
          index: 2,
          tool: "c",
          kind: "changed",
          argDiffs: [{ path: "args.x", before: 1, after: 2 }],
        },
      ],
    });
    expect(text).toContain("+ step[0] added");
    expect(text).toContain("- step[1] removed");
    expect(text).toContain("~ step[2] tool c args changed");
    expect(text).toContain("args.x: 1 -> 2");
  });
});
