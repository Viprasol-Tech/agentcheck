/**
 * Adapters that normalize provider-specific tool-call formats into agentcheck's
 * canonical {@link ToolCall} shape.
 *
 * These are intentionally thin and pure (no SDK imports) so they work offline
 * and against recorded payloads. Each `normalize*` function accepts the shape a
 * provider returns and yields a flat list of {@link ToolCall}.
 */
import type { ToolCall } from "../types.js";

/** Safely parse a JSON string of arguments; returns `{}` on empty/invalid. */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    } catch {
      return { _raw: raw };
    }
  }
  return { value: raw };
}

/** Minimal shape of an OpenAI chat-completion tool call. */
export interface OpenAIToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: string };
}

/**
 * Normalizes OpenAI tool calls (the `tool_calls` array on an assistant message,
 * where `arguments` is a JSON string).
 */
export function normalizeOpenAIToolCalls(
  toolCalls: OpenAIToolCall[],
): ToolCall[] {
  return toolCalls.map((tc) => ({
    tool: tc.function.name,
    args: parseArgs(tc.function.arguments),
  }));
}

/** Minimal shape of an Anthropic `tool_use` content block. */
export interface AnthropicToolUseBlock {
  type: "tool_use" | string;
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Normalizes Anthropic tool use. Accepts the full `content` array of an
 * assistant message and extracts the `tool_use` blocks (input is already an
 * object).
 */
export function normalizeAnthropicToolUse(
  content: AnthropicToolUseBlock[],
): ToolCall[] {
  return content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      tool: block.name,
      args: parseArgs(block.input),
    }));
}

/** Minimal shape of a LangGraph / LangChain tool call. */
export interface LangGraphToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/** Normalizes LangGraph / LangChain `tool_calls` (args already an object). */
export function normalizeLangGraphToolCalls(
  toolCalls: LangGraphToolCall[],
): ToolCall[] {
  return toolCalls.map((tc) => ({
    tool: tc.name,
    args: parseArgs(tc.args),
  }));
}

/** Supported provider identifiers for {@link normalizeToolCalls}. */
export type Provider = "openai" | "anthropic" | "langgraph";

/**
 * Dispatching helper: normalize an arbitrary provider payload to ToolCalls.
 * The payload type is provider-specific; callers pick the matching provider.
 */
export function normalizeToolCalls(
  provider: Provider,
  payload: unknown,
): ToolCall[] {
  switch (provider) {
    case "openai":
      return normalizeOpenAIToolCalls(payload as OpenAIToolCall[]);
    case "anthropic":
      return normalizeAnthropicToolUse(payload as AnthropicToolUseBlock[]);
    case "langgraph":
      return normalizeLangGraphToolCalls(payload as LangGraphToolCall[]);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}
