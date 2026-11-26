"""Helpers the gate tests share: write files into a temporary tree, turn it into a git repository."""

import subprocess
from pathlib import Path


def write(root: Path, relative: str, text: str = "", *, newline: bool = True) -> Path:
    """Writes `text` (plus a final newline unless told otherwise) to root/relative, creating folders."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + ("\n" if newline else ""), encoding="utf-8")
    return path


def git(root: Path, *args: str) -> str:
    """Runs git in root (identity and signing pinned so commits work in any environment)."""
    command = ["git", "-C", str(root), "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", *args]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def init_repo(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    git(root, "init", "--quiet", "--initial-branch=master")
    return root
