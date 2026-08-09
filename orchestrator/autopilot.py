"""Autopilot task-file CLI for Cursor-native TDD loops."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

DEFAULT_TASK = "docs/autopilot/overnight/repo-health.json"
ACTIVE_TASK_REL = ".autopilot/active-task.json"


def repo_root() -> Path:
    """Return repository root (parent of orchestrator package)."""
    return Path(__file__).resolve().parent.parent


def active_task_path(root: Path) -> Path:
    """Path to persisted active-task pointer."""
    return root / ACTIVE_TASK_REL


def load_active_task_file(root: Path) -> Path:
    """Resolve active task JSON path; fall back to default."""
    pointer = active_task_path(root)
    if pointer.is_file():
        data = json.loads(pointer.read_text(encoding="utf-8"))
        rel = data.get("taskFile", DEFAULT_TASK)
        return root / rel
    return root / DEFAULT_TASK


def load_task(root: Path, task_file: Path | None = None) -> tuple[dict[str, Any], Path]:
    """Load task JSON from explicit path or active pointer."""
    path = task_file or load_active_task_file(root)
    if not path.is_file():
        raise FileNotFoundError(f"Task file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8")), path


def save_task(path: Path, data: dict[str, Any]) -> None:
    """Write task JSON with trailing newline."""
    path.write_text(f"{json.dumps(data, indent=2)}\n", encoding="utf-8")


def set_active_task(root: Path, task_rel: str) -> Path:
    """Persist active task pointer and return absolute task path."""
    task_path = root / task_rel
    if not task_path.is_file():
        raise FileNotFoundError(f"Task file not found: {task_rel}")
    pointer = active_task_path(root)
    pointer.parent.mkdir(parents=True, exist_ok=True)
    pointer.write_text(
        f'{json.dumps({"taskFile": task_rel.replace("\\", "/")}, indent=2)}\n',
        encoding="utf-8",
    )
    return task_path


def incomplete_requirements(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Requirements not passed and not stuck."""
    return [
        r
        for r in data.get("requirements", [])
        if r.get("passes") is not True and r.get("stuck") is not True
    ]


def find_requirement(data: dict[str, Any], req_id: str) -> dict[str, Any]:
    """Find requirement by string id."""
    for req in data.get("requirements", []):
        if str(req.get("id")) == str(req_id):
            return req
    raise KeyError(f"Requirement id not found: {req_id}")


def run_verification(root: Path, commands: list[str]) -> bool:
    """Run shell verification commands from repo root."""
    for cmd in commands:
        result = subprocess.run(
            ["bash", "-lc", cmd],
            cwd=root,
            check=False,
        )
        if result.returncode != 0:
            return False
    return True


def cmd_use(root: Path, args: list[str]) -> int:
    """Set active task file."""
    if not args:
        print("Usage: python -m orchestrator autopilot use <task.json>", file=sys.stderr)
        return 2
    task_rel = args[0].replace("\\", "/")
    try:
        path = set_active_task(root, task_rel)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Active task: {task_rel}")
    print(f"  ({path})")
    return 0


def cmd_status(root: Path, _args: list[str]) -> int:
    """Print task summary and next work item."""
    try:
        data, path = load_task(root)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    reqs = data.get("requirements", [])
    total = len(reqs)
    done = sum(1 for r in reqs if r.get("passes") is True)
    stuck = sum(1 for r in reqs if r.get("stuck") is True)
    pending = incomplete_requirements(data)

    print(f"Task: {data.get('name', path.stem)}")
    print(f"File: {path.relative_to(root)}")
    print(f"Progress: {done} passed, {stuck} stuck, {len(pending)} pending / {total} total")

    if pending:
        nxt = pending[0]
        print(f"Next: [{nxt.get('id')}] {nxt.get('description', '')}")
    else:
        print("Next: (none — all complete or stuck)")
    return 0


def cmd_next(root: Path, _args: list[str]) -> int:
    """Print next incomplete requirement as JSON."""
    try:
        data, _path = load_task(root)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    pending = incomplete_requirements(data)
    if not pending:
        print("null")
        return 0
    print(json.dumps(pending[0], indent=2))
    return 0


def cmd_verify(root: Path, args: list[str]) -> int:
    """Run verification commands for a requirement."""
    if not args:
        print("Usage: python -m orchestrator autopilot verify <id>", file=sys.stderr)
        return 2
    try:
        data, path = load_task(root)
        req = find_requirement(data, args[0])
    except (FileNotFoundError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    commands = req.get("verification") or []
    if not commands:
        print(f"No verification commands for requirement {args[0]}")
        return 0

    ok = run_verification(root, commands)
    req["passes"] = ok
    save_task(path, data)
    if ok:
        print(f"Requirement {args[0]}: verification PASSED")
        return 0
    print(f"Requirement {args[0]}: verification FAILED", file=sys.stderr)
    return 1


def cmd_complete(root: Path, args: list[str]) -> int:
    """Mark requirement as passed."""
    if not args:
        print("Usage: python -m orchestrator autopilot complete <id>", file=sys.stderr)
        return 2
    try:
        data, path = load_task(root)
        req = find_requirement(data, args[0])
    except (FileNotFoundError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    req["passes"] = True
    req.pop("stuck", None)
    req.pop("blockedReason", None)
    if isinstance(req.get("tdd"), dict):
        for phase in ("test", "implement", "refactor"):
            if isinstance(req["tdd"].get(phase), dict):
                req["tdd"][phase]["passes"] = True
    save_task(path, data)
    print(f"Requirement {args[0]} marked complete in {path.relative_to(root)}")
    return 0


def main(args: list[str]) -> int:
    """Dispatch autopilot subcommands."""
    if not args:
        print(
            "Usage: python -m orchestrator autopilot "
            "<use|status|next|verify|complete> ...",
            file=sys.stderr,
        )
        return 2

    root = repo_root()
    command = args[0]
    rest = args[1:]

    handlers = {
        "use": cmd_use,
        "status": cmd_status,
        "next": cmd_next,
        "verify": cmd_verify,
        "complete": cmd_complete,
    }
    handler = handlers.get(command)
    if handler is None:
        print(f"Unknown subcommand: {command}", file=sys.stderr)
        return 2
    return handler(root, rest)
