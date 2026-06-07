# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-01

### Added
- Stable snapshot serialization with deep key sorting and configurable
  redaction (dotted paths + `*` wildcard).
- Structured diffing of agent runs: added / removed / changed / renamed tool
  calls, per-argument field diffs, input and output diffs.
- `exact` and `tolerant` comparison modes with an `ignore` list.
- `agentcheck.yaml` scenario configuration and parser (js-yaml).
- Pluggable `Judge` interface for LLM-as-judge with a deterministic offline
  fake judge.
- Pluggable `AgentRunner` and a runner that produces a pass/fail report plus a
  PR-comment-style markdown summary.
- Provider adapters: `normalizeToolCalls` for OpenAI, Anthropic, and LangGraph.
- CLI: `agentcheck run` and `agentcheck update`.
- Composite GitHub Action (`action.yml`) that runs in CI and comments the diff
  on the PR.
- Bundled offline example (sample agent + scenarios + snapshots).
- 77 unit tests (vitest); strict TypeScript.

[0.1.0]: https://github.com/Viprasol-Tech/agentcheck/releases/tag/v0.1.0
