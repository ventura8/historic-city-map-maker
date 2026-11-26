"""Process exit codes of a pipeline run (the Cloud Run Job task's exit status).

The job definitions run with `--max-retries 0` (retries belong to the dispatcher and the lease), and a
run that only WAITS on something outside us (USGS preparing or in maintenance, the admin's points or
approval) exits OK: `imagery.tick` resumes the job later, so no idle vCPU is billed.
"""

import enum


class ExitCode(enum.IntEnum):
    OK = 0
    """The job reached approval, waits, was cancelled or requeued, or was not this execution's to run."""
    FAILED = 1
    """The job failed (its document says why)."""
    USAGE = 2
    """Bad command line (unknown or missing step)."""
    CONFIG = 3
    """The job environment is incomplete or invalid; a retry cannot help."""
    OUTDATED = 75
    """The local worker under the starter's supervisor (`worker --supervised`, M7 §1.5) runs an image older than the
    installed pipeline's: the supervisor reads the installed image's digest, pulls it and starts again (75: sysexits'
    EX_TEMPFAIL, apart from Docker's own 125-137)."""
    REMOVE = 76
    """W5, Remove this computer (docs/research/M7-local-worker.md, *Household computers*): the admin asked, the worker accepted, and the
    starter's supervisor now cleans the computer up. 77 also removes Docker (where the helper installed it), 78 keeps the scanned
    maps, 79 both."""
    REMOVE_DOCKER = 77
    REMOVE_KEEP = 78
    REMOVE_KEEP_DOCKER = 79
