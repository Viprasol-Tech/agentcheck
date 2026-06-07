/**
 * Orchestrates running scenarios through a pluggable agent and comparing the
 * results to stored snapshots.
 */
import { diffRun, newScenarioDiff } from "./diff.js";
import { judgeOutputDiff, type Judge } from "./judge.js";
import {
  loadSnapshot,
  normalizeRun,
  saveSnapshot,
  snapshotExists,
} from "./snapshot.js";
import { snapshotFileFor } from "./scenarios.js";
import type {
  AgentRun,
  AgentcheckConfig,
  RunReport,
  ScenarioDef,
  ScenarioResult,
} from "./types.js";

/**
 * The agent under test. Given a scenario name and input, it must produce a
 * fully-formed {@link AgentRun}. In tests this is a deterministic fake; in real
 * usage it wraps your OpenAI/Anthropic/LangGraph agent.
 */
export type AgentRunner = (def: ScenarioDef) => Promise<AgentRun> | AgentRun;

/** Options for {@link runScenarios}. */
export interface RunnerOptions {
  config: AgentcheckConfig;
  /** Absolute snapshot directory. */
  snapshotDir: string;
  /** The agent under test. */
  agent: AgentRunner;
  /**
   * When true, write/refresh snapshots instead of comparing (the `update`
   * command). New runs always pass in this mode.
   */
  update?: boolean;
  /** Optional semantic judge used to rescue output-only regressions. */
  judge?: Judge;
}

/** Runs every scenario and produces an aggregate {@link RunReport}. */
export async function runScenarios(opts: RunnerOptions): Promise<RunReport> {
  const { config, snapshotDir, agent, update = false, judge } = opts;
  const results: ScenarioResult[] = [];

  for (const def of config.scenarios) {
    const fileName = snapshotFileFor(def);
    const run = await agent(def);

    if (update) {
      const snapshot = normalizeRun(run, {
        redact: config.redact,
      });
      saveSnapshot(snapshotDir, fileName, snapshot);
      results.push({
        scenario: def.name,
        diff: {
          scenario: def.name,
          pass: true,
          mode: config.mode,
          stepChanges: [],
          isNew: false,
        },
      });
      continue;
    }

    if (!snapshotExists(snapshotDir, fileName)) {
      results.push({
        scenario: def.name,
        diff: newScenarioDiff(run, config.mode),
      });
      continue;
    }

    const snapshot = loadSnapshot(snapshotDir, fileName);
    let diff = diffRun(run, snapshot, {
      mode: config.mode,
      redact: config.redact,
      ignore: config.ignore,
    });

    if (judge && !diff.pass) {
      const judged = await judgeOutputDiff(diff, snapshot, judge);
      diff = judged.diff;
    }

    results.push({ scenario: def.name, diff });
  }

  const passed = results.filter((r) => r.diff.pass).length;
  const failed = results.length - passed;
  const ok = results.every((r) => r.diff.pass);

  return { results, passed, failed, ok };
}
