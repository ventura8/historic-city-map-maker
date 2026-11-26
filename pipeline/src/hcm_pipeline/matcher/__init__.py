"""The local matcher's sidecar (docs/research/M10-local-ai.md): ALIKED + LightGlue in its own container, with no network.

This folder is copied as it is into the volume `hcm-ai-files` and runs under another Python (the measured PyTorch image's 3.12), so
nothing in it imports `hcm_pipeline`; its modules name each other relatively. Only `search.py` needs OpenCV and only `torch_backend.py`
needs PyTorch; the worker itself imports `box.py` alone, so Cloud Run's image carries these files and never runs them.
"""
