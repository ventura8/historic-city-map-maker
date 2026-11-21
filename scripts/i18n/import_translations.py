#!/usr/bin/env python3
"""The owner's entry to scripts/ci/import_translations.py (docs/I18N.md → Importing translations), where the gates check it."""

import runpy
import sys
from pathlib import Path

CI = Path(__file__).resolve().parents[1] / "ci"

if __name__ == "__main__":
    sys.path.insert(0, str(CI))
    runpy.run_path(str(CI / "import_translations.py"), run_name="__main__")
