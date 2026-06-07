#!/usr/bin/env python3
"""Render agentcheck's headline FAIL-diff output to docs/assets/demo.svg.

agentcheck is a TypeScript project, so there is no Python render path to import.
Instead this script runs the *real* CLI against the bundled example to capture
genuine stdout, then paints it with rich and exports a colored SVG terminal
screenshot for the README hero. This keeps the image faithful to actual output
while remaining fully reproducible (no screen recording, no manual editing).

Run from the repo root with Node/npx available:

    python docs/make_demo.py

It writes docs/assets/demo.svg.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.text import Text

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "docs" / "assets"
SVG_PATH = ASSETS_DIR / "demo.svg"


def run_cli(args: list[str], regress: bool) -> str:
    """Run the real agentcheck CLI and return combined stdout (text)."""
    env = dict(os.environ)
    if regress:
        env["AGENTCHECK_REGRESS"] = "1"
    else:
        env.pop("AGENTCHECK_REGRESS", None)
    cmd = ["npx", "tsx", "bin/agentcheck.ts", *args]
    proc = subprocess.run(  # noqa: S603 - fixed, trusted command
        cmd,
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        shell=(os.name == "nt"),
    )
    return proc.stdout.rstrip("\n")


def style_for(line: str) -> str:
    """Choose a rich style for a captured output line."""
    stripped = line.strip()
    if stripped.startswith("FAIL") or stripped.startswith("- ") or "RESULT: FAIL" in line:
        return "bold red"
    if stripped.startswith("PASS") or "RESULT: PASS" in line:
        return "bold green"
    if stripped.startswith("~"):
        return "yellow"
    if "->" in line:
        return "red"
    if stripped.startswith("before:"):
        return "red"
    if stripped.startswith("after:"):
        return "green"
    if line.startswith("$ "):
        return "bold cyan"
    if line.startswith("agentcheck:"):
        return "dim"
    return "white"


def emit(console: Console, line: str) -> None:
    console.print(Text(line, style=style_for(line)))


def main() -> int:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # Refresh the committed baseline snapshots so the run is deterministic.
    run_cli(["update", "--dir", "example"], regress=False)
    fail_out = run_cli(["run", "--dir", "example"], regress=True)

    if "RESULT: FAIL" not in fail_out:
        sys.stderr.write("Expected a FAIL result from the regressed run.\n")
        sys.stderr.write(fail_out + "\n")
        return 1

    console = Console(record=True, width=100)

    console.print(Text("$ AGENTCHECK_REGRESS=1 npx agentcheck run --dir example", style="bold cyan"))
    console.print(Text("# the agent regressed -> agentcheck catches it (exit 1)", style="dim"))
    console.print()
    for line in fail_out.splitlines():
        emit(console, line)

    console.save_svg(str(SVG_PATH), title="agentcheck demo")
    size = SVG_PATH.stat().st_size
    sys.stdout.write(f"Wrote {SVG_PATH} ({size} bytes)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
