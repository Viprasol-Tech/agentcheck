# agentcheck example

A fully offline demo: a deterministic fake agent (`agent.ts`), two scenarios
(`agentcheck.yaml`), and committed baseline snapshots (`.agentcheck/snapshots/`).

From the repository root:

```bash
# 1. Record/refresh the baseline snapshots
npx tsx bin/agentcheck.ts update --dir example

# 2. Re-run; nothing changed -> PASS (exit 0)
npx tsx bin/agentcheck.ts run --dir example

# 3. Simulate a regression -> FAIL (exit 1, prints the diff)
AGENTCHECK_REGRESS=1 npx tsx bin/agentcheck.ts run --dir example
```

`AGENTCHECK_REGRESS=1` makes the fake agent geocode Paris to the wrong country
and skip the flight-booking tool call, so you can see agentcheck catch both a
changed argument and a removed tool call.
