/**
 * The georeferencing mathematics the admin's georeferencer and `imagery.saveGcps` share (`docs/research/M3-interfaces.md`
 * §6): the fits, their residuals and the warped preview's mesh, held to the pipeline's numpy answers by the golden cases; and the
 * map of a frame fitted over terrain (M15), held to GDAL's by `pipeline/tests/contracts/terrain-map.json`.
 */
export { distanceFromFit, fitTransform } from './fit.js';
export type { FitRefusal, FitResult, FittedTransform, PixelPoint } from './fit.js';
export { geoToMercator, groundMetres, mercatorToGeo, WEB_MERCATOR_RADIUS_M } from './mercator.js';
export type { GeoPoint, PlanePoint } from './mercator.js';
export { previewMesh, scanBounds, triangleTransform } from './mesh.js';
export type { MeshQuad } from './mesh.js';
export { terrainTransform } from './terrain.js';
