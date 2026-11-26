"""M25 (docs/research/M25-landsat.md): a Landsat scene's own path through a `usgs-import`.

A Landsat Collection 2 Level-1 scene is already georeferenced: `extract` keeps the bands the true colour needs (`bands.py`), `stitch`,
`locate` and `georef` are skipped (`route.py`), `reference` draws the window's Sentinel-2 as for any frame, and `warp` composes the
colour image on the tile grid, stretched per scene, checked against Sentinel-2 (`compose.py`, `colour.py`, `offset.py`); `export`,
`pyramid` and `register` then run as for any layer.
"""
