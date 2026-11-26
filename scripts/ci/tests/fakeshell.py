"""A stand-in for the subprocess-backed context of scripts/ci/pipeline.py (test_pipeline*.py)."""

from collections.abc import Sequence
from pathlib import Path

from gate_runner import Output

from pipeline import Context


class FakeShell:
    """Records every command and prints `ran <argv>`; a command fails when one of `failing` is a substring of it."""

    def __init__(self, root: Path, failing: Sequence[str] = (), ls_files: Sequence[str] = ()) -> None:
        self.root = root
        self.failing = tuple(failing)
        self.ls_files = "\0".join(ls_files) + ("\0" if ls_files else "")
        self.calls: list[list[str]] = []
        self.captured: list[list[str]] = []
        self.printed: list[str] = []

    def run(self, argv: Sequence[str], out: Output) -> int:
        self.calls.append(list(argv))
        line = " ".join(argv)
        out(f"ran {line}\n")
        return 1 if any(token in line for token in self.failing) else 0

    def capture(self, argv: Sequence[str]) -> str:
        self.captured.append(list(argv))
        outputs = {"ls-files": self.ls_files, "rev-parse": "0123abcd\n", "status": "?? new-file.ts\n"}
        return outputs[argv[1]]

    def context(self, jobs: int = 1) -> Context:
        return Context(root=self.root, run=self.run, capture=self.capture, write=self.printed.append, jobs=jobs)
