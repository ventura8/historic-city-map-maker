"""M20: a local archive of scanned maps, read where it lies by the owner's worker (docs/research/M20-import-local.md).

`intake` takes the files over the worker's loopback page or from a zip read in place (`zipread`), `probe` reads each one in a
sandboxed child, `classify` groups them into series (with the name grammars of `grammar`), `rights` and `encoding` prefill what
the owner checks, and `report` builds what goes to the server: series and counts, never a host path or a file's content.
"""
