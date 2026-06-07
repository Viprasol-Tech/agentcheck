/**
 * Parsing and loading of `agentcheck.yaml` configuration.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import type { AgentcheckConfig, ScenarioDef } from "./types.js";

const DEFAULT_SNAPSHOT_DIR = ".agentcheck/snapshots";

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`agentcheck config: "${field}" must be a list of strings`);
  }
  return value.map((v, i) => {
    if (typeof v !== "string") {
      throw new Error(`agentcheck config: "${field}[${i}]" must be a string`);
    }
    return v;
  });
}

/** Parses an `agentcheck.yaml` document (already read into a string). */
export function parseConfig(text: string): AgentcheckConfig {
  const raw = yaml.load(text);
  if (raw === null || raw === undefined) {
    throw new Error("agentcheck config: file is empty");
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("agentcheck config: root must be a mapping");
  }
  const obj = raw as Record<string, unknown>;

  const modeRaw = obj.mode ?? "exact";
  if (modeRaw !== "exact" && modeRaw !== "tolerant") {
    throw new Error(
      `agentcheck config: "mode" must be "exact" or "tolerant", got ${JSON.stringify(modeRaw)}`,
    );
  }

  const snapshotDir =
    typeof obj.snapshotDir === "string" ? obj.snapshotDir : DEFAULT_SNAPSHOT_DIR;

  const scenariosRaw = obj.scenarios;
  if (!Array.isArray(scenariosRaw) || scenariosRaw.length === 0) {
    throw new Error('agentcheck config: "scenarios" must be a non-empty list');
  }

  const seen = new Set<string>();
  const scenarios: ScenarioDef[] = scenariosRaw.map((s, i) => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      throw new Error(`agentcheck config: scenarios[${i}] must be a mapping`);
    }
    const sc = s as Record<string, unknown>;
    if (typeof sc.name !== "string" || sc.name.length === 0) {
      throw new Error(`agentcheck config: scenarios[${i}].name is required`);
    }
    if (typeof sc.input !== "string") {
      throw new Error(
        `agentcheck config: scenarios[${i}].input must be a string`,
      );
    }
    if (seen.has(sc.name)) {
      throw new Error(`agentcheck config: duplicate scenario name "${sc.name}"`);
    }
    seen.add(sc.name);

    const def: ScenarioDef = { name: sc.name, input: sc.input };
    if (typeof sc.snapshot === "string") {
      def.snapshot = sc.snapshot;
    }
    return def;
  });

  const config: AgentcheckConfig = {
    snapshotDir,
    mode: modeRaw,
    redact: asStringArray(obj.redact, "redact"),
    ignore: asStringArray(obj.ignore, "ignore"),
    scenarios,
  };
  if (typeof obj.agent === "string") {
    config.agent = obj.agent;
  }
  return config;
}

/** Resolves the snapshot file name for a scenario (defaults to `<name>.json`). */
export function snapshotFileFor(def: ScenarioDef): string {
  return def.snapshot ?? `${sanitize(def.name)}.json`;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/**
 * Locates the `agentcheck.yaml` config file given a directory or explicit path.
 * If `pathOrDir` is a directory, looks for `agentcheck.yaml` / `agentcheck.yml`
 * inside it.
 */
export function resolveConfigPath(pathOrDir: string): string {
  if (existsSync(pathOrDir) && pathOrDir.match(/\.ya?ml$/)) {
    return pathOrDir;
  }
  for (const name of ["agentcheck.yaml", "agentcheck.yml"]) {
    const candidate = join(pathOrDir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No agentcheck.yaml found at or in: ${pathOrDir}`);
}

/** Loaded config plus the resolved absolute snapshot directory. */
export interface LoadedConfig {
  config: AgentcheckConfig;
  /** Directory containing the config file. */
  baseDir: string;
  /** Absolute snapshot directory. */
  snapshotDir: string;
  /** Absolute path of the config file. */
  configPath: string;
}

/** Reads and resolves an `agentcheck.yaml` from disk. */
export function loadConfig(pathOrDir: string): LoadedConfig {
  const configPath = resolveConfigPath(pathOrDir);
  const baseDir = dirname(configPath);
  const config = parseConfig(readFileSync(configPath, "utf8"));
  return {
    config,
    baseDir,
    snapshotDir: join(baseDir, config.snapshotDir),
    configPath,
  };
}
