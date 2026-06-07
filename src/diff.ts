/**
 * Structured diffing of a fresh agent run against a stored snapshot.
 */
import { normalizeRun } from "./snapshot.js";
import type {
  AgentRun,
  DiffOptions,
  DiffResult,
  FieldDiff,
  Snapshot,
  StepChange,
  ToolCall,
} from "./types.js";

/** Stable structural equality on JSON-safe values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    if (!ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

/** True if a dotted field path matches one of the ignore patterns. */
function isIgnored(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === path) return true;
    // Support single-level wildcard `*` matching across dotted segments.
    const pParts = pattern.split(".");
    const tParts = path.split(".");
    if (pParts.length !== tParts.length) continue;
    if (pParts.every((p, i) => p === "*" || p === tParts[i])) return true;
  }
  return false;
}

/**
 * Computes field-level diffs between two argument objects (or any JSON values),
 * returning one {@link FieldDiff} per leaf that changed. Honors `ignore`.
 */
export function diffArgs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  basePath: string,
  ignore: string[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    const path = basePath ? `${basePath}.${key}` : key;
    if (isIgnored(path, ignore)) continue;
    const b = before[key];
    const a = after[key];
    const bHas = key in before;
    const aHas = key in after;
    if (bHas && aHas) {
      if (!deepEqual(b, a)) {
        diffs.push({ path, before: b, after: a });
      }
    } else if (!bHas && aHas) {
      diffs.push({ path, after: a });
    } else {
      diffs.push({ path, before: b });
    }
  }
  return diffs;
}

/**
 * Diffs the ordered step lists positionally. Steps at the same index are
 * compared; trailing extra steps are reported as added/removed.
 */
function diffSteps(
  before: ToolCall[],
  after: ToolCall[],
  ignore: string[],
): StepChange[] {
  const changes: StepChange[] = [];
  const max = Math.max(before.length, after.length);

  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];

    if (b && !a) {
      changes.push({ index: i, tool: b.tool, kind: "removed" });
      continue;
    }
    if (!b && a) {
      changes.push({ index: i, tool: a.tool, kind: "added" });
      continue;
    }
    if (!b || !a) continue;

    const toolRenamed = b.tool !== a.tool;
    const argDiffs = diffArgs(b.args ?? {}, a.args ?? {}, "args", ignore);

    if (toolRenamed || argDiffs.length > 0) {
      const change: StepChange = {
        index: i,
        tool: a.tool,
        kind: "changed",
      };
      if (argDiffs.length > 0) change.argDiffs = argDiffs;
      if (toolRenamed) {
        change.toolRenamed = true;
        change.previousTool = b.tool;
      }
      changes.push(change);
    }
  }

  return changes;
}

/**
 * Diffs a fresh {@link AgentRun} against a stored {@link Snapshot}.
 *
 * The run is first normalized with the same options as the snapshot (redaction,
 * whitespace) so the comparison is apples-to-apples. In `tolerant` mode the
 * `ignore` paths are additionally excluded and metadata-only changes never
 * fail the verdict.
 */
export function diffRun(
  run: AgentRun,
  snapshot: Snapshot,
  opts: DiffOptions = {},
): DiffResult {
  const mode = opts.mode ?? "exact";
  const ignore = mode === "tolerant" ? [...(opts.ignore ?? [])] : [];

  const normalized = normalizeRun(run, {
    redact: opts.redact,
    normalizeWhitespace: opts.normalizeWhitespace,
  });

  const stepChanges = diffSteps(snapshot.steps, normalized.steps, ignore);

  let outputDiff: FieldDiff | undefined;
  if (
    !isIgnored("finalOutput", ignore) &&
    snapshot.finalOutput !== normalized.finalOutput
  ) {
    outputDiff = {
      path: "finalOutput",
      before: snapshot.finalOutput,
      after: normalized.finalOutput,
    };
  }

  let inputDiff: FieldDiff | undefined;
  if (
    !isIgnored("input", ignore) &&
    snapshot.input !== normalized.input
  ) {
    inputDiff = {
      path: "input",
      before: snapshot.input,
      after: normalized.input,
    };
  }

  const pass =
    stepChanges.length === 0 &&
    outputDiff === undefined &&
    inputDiff === undefined;

  const result: DiffResult = {
    scenario: run.scenario,
    pass,
    mode,
    stepChanges,
    isNew: false,
  };
  if (outputDiff) result.outputDiff = outputDiff;
  if (inputDiff) result.inputDiff = inputDiff;
  return result;
}

/** Produces a DiffResult representing a brand-new scenario with no snapshot. */
export function newScenarioDiff(run: AgentRun, mode: "exact" | "tolerant"): DiffResult {
  return {
    scenario: run.scenario,
    pass: false,
    mode,
    stepChanges: [],
    isNew: true,
  };
}
