"""Type stubs for GDAL's Python bindings (the `osgeo` package of the ghcr.io/osgeo/gdal image).

GDAL ships no type information, so mypy reads these stubs (`mypy_path` in pipeline/pyproject.toml).
They describe only what the repository calls; add a name together with its first caller.
"""

__version__: str
