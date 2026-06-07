/**
 * Optional LLM-as-judge equivalence scoring behind a pluggable interface.
 *
 * The {@link Judge} interface lets you decide whether a regressed output is
 * *semantically* equivalent to the snapshot even when it is not byte-identical
 * (e.g. paraphrased prose). The real implementation would call an LLM; this
 * module ships a deterministic, offline {@link fakeJudge} so the demo and the
 * whole test suite run with no network and no API keys.
 */
import type { Snapshot, DiffResult } from "./types.js";

/** Verdict returned by a judge. */
export interface JudgeVerdict {
  equivalent: boolean;
  reason: string;
}

/**
 * A pluggable judge. Receives the stored (`a`) and new (`b`) output strings and
 * decides whether they are equivalent. Async to allow real LLM calls.
 */
export type Judge = (a: string, b: string) => Promise<JudgeVerdict>;

/** Lowercases, strips punctuation, and collapses whitespace. */
function canonical(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(canonical(s).split(" ").filter(Boolean));
}

/** Jaccard similarity between the token sets of two strings (0..1). */
export function tokenSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Builds a deterministic offline judge. Two outputs are deemed equivalent when
 * their canonical forms are identical or their token similarity meets the
 * threshold. This is a stand-in that behaves predictably for tests/demos.
 */
export function fakeJudge(threshold = 0.85): Judge {
  return async (a: string, b: string): Promise<JudgeVerdict> => {
    if (canonical(a) === canonical(b)) {
      return {
        equivalent: true,
        reason: "Outputs are identical after canonicalization.",
      };
    }
    const sim = tokenSimilarity(a, b);
    if (sim >= threshold) {
      return {
        equivalent: true,
        reason: `Outputs are ${(sim * 100).toFixed(0)}% similar (>= ${(threshold * 100).toFixed(0)}% threshold).`,
      };
    }
    return {
      equivalent: false,
      reason: `Outputs are only ${(sim * 100).toFixed(0)}% similar (< ${(threshold * 100).toFixed(0)}% threshold).`,
    };
  };
}

/**
 * Applies a judge to an output-only diff. If the diff failed *solely* because of
 * the final output, the judge may rescue it (mark it as passing) when it deems
 * the outputs equivalent. Tool-call diffs are never overridden by the judge.
 */
export async function judgeOutputDiff(
  diff: DiffResult,
  snapshot: Snapshot,
  judge: Judge,
): Promise<{ diff: DiffResult; verdict?: JudgeVerdict }> {
  const onlyOutputChanged =
    !diff.pass &&
    !diff.isNew &&
    diff.stepChanges.length === 0 &&
    diff.inputDiff === undefined &&
    diff.outputDiff !== undefined;

  if (!onlyOutputChanged || diff.outputDiff === undefined) {
    return { diff };
  }

  const verdict = await judge(
    snapshot.finalOutput,
    String(diff.outputDiff.after ?? ""),
  );

  if (verdict.equivalent) {
    const rescued: DiffResult = { ...diff, pass: true };
    delete rescued.outputDiff;
    return { diff: rescued, verdict };
  }
  return { diff, verdict };
}
