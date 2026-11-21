/**
 * The georeferencer's warp chunk (the admin's `georef-warp-<hash>.js`, 2026-11-12): the live warped preview's mesh and triangles
 * (`./warp.ts`, with `previewMesh`, `scanBounds` and `triangleTransform` of `@hcm/shared`), fetched by `./georef-pictures.ts` when a
 * version opens and drawn once a fit exists, so the `georef` chunk keeps its 19 KB with the ghost and the sharper scan.
 */
export { warpFrame, warpSideFor, warpTriangles } from './warp.js';
