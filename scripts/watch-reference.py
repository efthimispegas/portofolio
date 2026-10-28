#!/usr/bin/env python3
"""Run the installed watch skill using this project's private configuration."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILL_SCRIPTS = Path.home() / ".codex" / "skills" / "watch" / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))

from config import ConfigError, read_env_file  # noqa: E402


def main() -> int:
    try:
        settings = read_env_file(ROOT / ".env")
    except ConfigError as error:
        print(str(error), file=sys.stderr)
        return 2
    required = ("WATCH_ENGINE", "WATCH_GEMINI_MODEL", "GEMINI_API_KEY")
    missing = [name for name in required if not settings.get(name, "").strip()]
    if missing:
        print(f"Set {', '.join(missing)} in {ROOT / '.env'}.", file=sys.stderr)
        return 2
    environment = os.environ.copy()
    # Explicit values prevent a global key/model from taking precedence.
    environment.update({name: settings[name] for name in required})
    return subprocess.run(
        [sys.executable, str(SKILL_SCRIPTS / "watch.py"), *sys.argv[1:]],
        cwd=ROOT,
        env=environment,
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
