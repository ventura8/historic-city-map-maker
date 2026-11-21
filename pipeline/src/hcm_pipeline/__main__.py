"""`python -m hcm_pipeline <step>`: the entry point of the Cloud Run Job image."""

import sys

from hcm_pipeline.heap import limit_arenas
from hcm_pipeline.main import main

if __name__ == "__main__":
    # Before any GDAL thread exists: at most two malloc arenas, so the threads' freed blocks can be given back (heap.py).
    limit_arenas()
    sys.exit(main())
