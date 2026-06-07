import { describe, it, expect } from "vitest";
import {
  normalizeOpenAIToolCalls,
  normalizeAnthropicToolUse,
  normalizeLangGraphToolCalls,
  normalizeToolCalls,
} from "../src/adapters/index.js";

describe("normalizeOpenAIToolCalls", () => {
  it("parses JSON string arguments", () => {
    const out = normalizeOpenAIToolCalls([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Paris"}' },
      },
    ]);
    expect(out).toEqual([{ tool: "get_weather", args: { city: "Paris" } }]);
  });

  it("treats empty arguments as an empty object", () => {
    const out = normalizeOpenAIToolCalls([
      { function: { name: "noop", arguments: "" } },
    ]);
    expect(out[0].args).toEqual({});
  });

  it("falls back to _raw on invalid JSON", () => {
    const out = normalizeOpenAIToolCalls([
      { function: { name: "x", arguments: "{not json" } },
    ]);
    expect(out[0].args).toEqual({ _raw: "{not json" });
  });
});

describe("normalizeAnthropicToolUse", () => {
  it("extracts tool_use blocks and ignores text blocks", () => {
    const out = normalizeAnthropicToolUse([
      { type: "text", name: "", input: {} },
      { type: "tool_use", id: "tu_1", name: "search", input: { q: "cats" } },
    ]);
    expect(out).toEqual([{ tool: "search", args: { q: "cats" } }]);
  });

  it("returns empty when there are no tool_use blocks", () => {
    const out = normalizeAnthropicToolUse([
      { type: "text", name: "", input: {} },
    ]);
    expect(out).toEqual([]);
  });
});

describe("normalizeLangGraphToolCalls", () => {
  it("maps name/args directly", () => {
    const out = normalizeLangGraphToolCalls([
      { name: "lookup", args: { id: 7 }, id: "abc" },
    ]);
    expect(out).toEqual([{ tool: "lookup", args: { id: 7 } }]);
  });
});

describe("normalizeToolCalls dispatch", () => {
  it("dispatches to the openai normalizer", () => {
    const out = normalizeToolCalls("openai", [
      { function: { name: "a", arguments: '{"x":1}' } },
    ]);
    expect(out).toEqual([{ tool: "a", args: { x: 1 } }]);
  });

  it("dispatches to the anthropic normalizer", () => {
    const out = normalizeToolCalls("anthropic", [
      { type: "tool_use", name: "b", input: { y: 2 } },
    ]);
    expect(out).toEqual([{ tool: "b", args: { y: 2 } }]);
  });

  it("dispatches to the langgraph normalizer", () => {
    const out = normalizeToolCalls("langgraph", [
      { name: "c", args: { z: 3 } },
    ]);
    expect(out).toEqual([{ tool: "c", args: { z: 3 } }]);
  });

  it("produces a snapshot-comparable shape across providers", () => {
    const openai = normalizeToolCalls("openai", [
      { function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
    ]);
    const anthropic = normalizeToolCalls("anthropic", [
      { type: "tool_use", name: "get_weather", input: { city: "Paris" } },
    ]);
    expect(openai).toEqual(anthropic);
  });
});
