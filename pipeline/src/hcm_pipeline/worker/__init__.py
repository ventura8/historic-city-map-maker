"""The local worker (M7, `docs/research/M7-local-worker.md`): `python -m hcm_pipeline worker --city <id> --project <id>`.

The same pipeline image, run on the owner's computer: a local page (`server.py`, `page.py`) signs the owner in with
Google and hands the worker a Firebase ID token and refresh token, held in memory only (`session.py`); the worker then
claims the city's local jobs (`loop.py`) and runs each with the normal runner, its two ports swapped (`runtime.py`):
documents through `worker.step` (`documents.py`), the version's files through signed URLs and everything else in the
work folder (`signed_store.py`, `local_store.py`, `routed.py`), USGS through `worker.urls` (`m2m_proxy.py`). Every call
to the server is one of the five admin-only callables (`api.py`).
"""
