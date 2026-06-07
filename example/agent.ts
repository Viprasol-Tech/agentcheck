/**
 * Example agent-under-test for agentcheck.
 *
 * This is a fully offline, deterministic stand-in for a real LLM agent. It maps
 * each scenario input to a fixed sequence of tool calls + a final answer, so the
 * demo and CI run with no network and no API keys.
 *
 * Set AGENTCHECK_REGRESS=1 to simulate a regression (a changed tool argument, a
 * dropped tool call, and a reworded answer) so you can see agentcheck FAIL.
 */
import type { AgentRun, ScenarioDef } from "../src/index.js";

const REGRESS = process.env.AGENTCHECK_REGRESS === "1";

export default function agent(def: ScenarioDef): AgentRun {
  const ts = new Date().toISOString(); // volatile field, redacted via config
  const id = `run_${Math.random().toString(36).slice(2)}`; // volatile id

  if (def.name === "weather-in-paris") {
    return {
      scenario: def.name,
      input: def.input,
      meta: { runId: id, startedAt: ts },
      steps: [
        {
          tool: "geocode",
          args: { query: "Paris", country: REGRESS ? "DE" : "FR" },
          meta: { latencyMs: 12 },
        },
        {
          tool: "get_weather",
          args: { lat: 48.8566, lon: 2.3522, units: "celsius" },
          meta: { latencyMs: 30 },
        },
      ],
      finalOutput: "It is 18C and partly cloudy in Paris.",
    };
  }

  if (def.name === "book-a-flight") {
    const steps = [
      {
        tool: "search_flights",
        args: { from: "SFO", to: "JFK", date: "2025-12-01" },
        meta: { latencyMs: 55 },
      },
      {
        tool: "select_flight",
        args: { flightId: "UA-512", seat: "14C" },
        meta: { latencyMs: 8 },
      },
      {
        tool: "create_booking",
        args: { flightId: "UA-512", passengers: 1 },
        meta: { latencyMs: 41 },
      },
    ];
    // Regression: the agent forgets to actually create the booking.
    const finalSteps = REGRESS ? steps.slice(0, 2) : steps;
    return {
      scenario: def.name,
      input: def.input,
      meta: { runId: id, startedAt: ts },
      steps: finalSteps,
      finalOutput: REGRESS
        ? "I found a flight from SFO to JFK."
        : "Booked flight UA-512 from SFO to JFK, seat 14C.",
    };
  }

  // Default fallback scenario.
  return {
    scenario: def.name,
    input: def.input,
    meta: { runId: id, startedAt: ts },
    steps: [{ tool: "echo", args: { text: def.input } }],
    finalOutput: `You said: ${def.input}`,
  };
}
