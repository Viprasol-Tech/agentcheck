/**
 * Core data types for agentcheck.
 *
 * An {@link AgentRun} is the observable behavior of an agent for one scenario:
 * the ordered sequence of tool calls (name + arguments) it made plus the final
 * output it produced. A {@link Snapshot} is a normalized, stable, on-disk form
 * of an AgentRun. A {@link DiffResult} is the structured comparison between a
 * fresh run and a stored snapshot.
 */

/** A single tool call made by an agent during a run. */
export interface ToolCall {
  /** The tool / function name the agent invoked. */
  tool: string;
  /** The arguments passed to the tool, as a plain object. */
  args: Record<string, unknown>;
  /**
   * Optional captured result of the tool call. Diffing ignores this by default
   * (results are often non-deterministic), but it is preserved in snapshots
   * for human inspection.
   */
  result?: unknown;
  /** Optional free-form metadata (timestamps, ids, latency, ...). */
  meta?: Record<string, unknown>;
}

/** The full observed behavior of an agent for one scenario. */
export interface AgentRun {
  /** Unique scenario name this run corresponds to. */
  scenario: string;
  /** The input/prompt that was given to the agent. */
  input: string;
  /** Ordered list of tool calls the agent made. */
  steps: ToolCall[];
  /** The agent's final textual output. */
  finalOutput: string;
  /** Optional free-form metadata about the run as a whole. */
  meta?: Record<string, unknown>;
}

/** Options controlling how runs are normalized into snapshots / compared. */
export interface NormalizeOptions {
  /**
   * Dotted field paths to redact (replace with a stable placeholder) before
   * snapshotting / diffing. Supports a leading wildcard segment `*` to match
   * any key at that position. Examples: `meta.timestamp`, `steps.*.meta.id`,
   * `args.requestId`.
   */
  redact?: string[];
  /**
   * If true, the final output is trimmed and internal runs of whitespace are
   * collapsed before comparison. Defaults to false.
   */
  normalizeWhitespace?: boolean;
}

/** A normalized, on-disk representation of an {@link AgentRun}. */
export interface Snapshot {
  /** Snapshot format version, for forward compatibility. */
  version: 1;
  /** Scenario name. */
  scenario: string;
  /** The normalized input. */
  input: string;
  /** Normalized, stable-key-ordered tool calls. */
  steps: ToolCall[];
  /** Normalized final output. */
  finalOutput: string;
  /** Normalized run-level metadata (may be omitted if empty). */
  meta?: Record<string, unknown>;
}

/** How a single tool call changed between snapshot and new run. */
export interface StepChange {
  /** Index of the step within the run. */
  index: number;
  /** Tool name at this index (from the new run, or snapshot if removed). */
  tool: string;
  /** Kind of change. */
  kind: "added" | "removed" | "changed";
  /** Human-readable per-field details (only for `changed`). */
  argDiffs?: FieldDiff[];
  /** True if the tool *name* itself changed at this index. */
  toolRenamed?: boolean;
  /** Previous tool name when renamed. */
  previousTool?: string;
}

/** A single field-level difference. */
export interface FieldDiff {
  /** Dotted path of the field that changed. */
  path: string;
  /** Value in the stored snapshot (undefined if newly added). */
  before?: unknown;
  /** Value in the new run (undefined if removed). */
  after?: unknown;
}

/** The structured result of comparing a new run against a stored snapshot. */
export interface DiffResult {
  /** Scenario name. */
  scenario: string;
  /** True when the run matches the snapshot under the active mode. */
  pass: boolean;
  /** Comparison mode used. */
  mode: "exact" | "tolerant";
  /** Per-step changes (added / removed / changed tool calls). */
  stepChanges: StepChange[];
  /** Field diffs on the final output (empty when unchanged). */
  outputDiff?: FieldDiff;
  /** Field diffs on the run input (empty when unchanged). */
  inputDiff?: FieldDiff;
  /** True if no stored snapshot existed (a brand-new scenario). */
  isNew: boolean;
}

/** Options controlling diff behavior. */
export interface DiffOptions extends NormalizeOptions {
  /**
   * `exact` requires an identical normalized snapshot. `tolerant` additionally
   * ignores any field paths listed in {@link DiffOptions.ignore} and never
   * fails on metadata-only differences.
   */
  mode?: "exact" | "tolerant";
  /**
   * Extra field paths to ignore in `tolerant` mode (in addition to redaction).
   * Same path syntax as {@link NormalizeOptions.redact}.
   */
  ignore?: string[];
}

/** A scenario definition parsed from `agentcheck.yaml`. */
export interface ScenarioDef {
  /** Unique scenario name. */
  name: string;
  /** The input/prompt to feed the agent under test. */
  input: string;
  /** Snapshot filename (relative to the snapshots dir). Defaults to `<name>.json`. */
  snapshot?: string;
}

/** Top-level parsed `agentcheck.yaml` config. */
export interface AgentcheckConfig {
  /**
   * Path (relative to the config file) of the agent-under-test module. It must
   * export a default function `(scenarioDef) => AgentRun`. Optional here so the
   * library can be driven programmatically without a module path.
   */
  agent?: string;
  /** Directory holding stored snapshots, relative to the config file. */
  snapshotDir: string;
  /** Comparison mode. */
  mode: "exact" | "tolerant";
  /** Global redaction paths. */
  redact: string[];
  /** Global ignore paths (tolerant mode). */
  ignore: string[];
  /** The scenarios to run. */
  scenarios: ScenarioDef[];
}

/** Result of running and comparing a single scenario. */
export interface ScenarioResult {
  scenario: string;
  diff: DiffResult;
}

/** Aggregate report across all scenarios. */
export interface RunReport {
  results: ScenarioResult[];
  passed: number;
  failed: number;
  /** True when every scenario passed (and none were unexpectedly new). */
  ok: boolean;
}
