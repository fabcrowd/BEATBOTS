"""Entry point: python -m orchestrator autopilot <subcommand> ..."""

from __future__ import annotations

import sys

from orchestrator.autopilot import main as autopilot_main


def main(argv: list[str] | None = None) -> int:
    """Dispatch orchestrator subcommands."""
    args = list(argv if argv is not None else sys.argv[1:])
    if not args or args[0] != "autopilot":
        print(
            "Usage: python -m orchestrator autopilot <use|status|next|verify|complete> ...",
            file=sys.stderr,
        )
        return 2
    return autopilot_main(args[1:])


if __name__ == "__main__":
    raise SystemExit(main())
