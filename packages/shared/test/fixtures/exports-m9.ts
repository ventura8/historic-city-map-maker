/** M9 (`docs/research/M9-calibration.md`): the public API of calibration, for `index.test.ts`. */
import { M13_EXPORTS } from './exports-m13.js';
import { M14_EXPORTS } from './exports-m14.js';
import { M16_EXPORTS } from './exports-m16.js';
import { M17_EXPORTS } from './exports-m17.js';

export const M9_EXPORTS = [
    ...M13_EXPORTS,
    ...M14_EXPORTS,
    ...M16_EXPORTS,
    ...M17_EXPORTS,
    'CALIBRATION_HOWS',
    'CALIBRATION_OUTLINE_MAX',
    'CALIBRATION_REFUSALS',
    'CHECKPOINT_KINDS',
    'AUTO_MIN_MEASURED_PCT',
    'measuredOutlineSchema',
    'CITY_MIN_COVERAGE_PCT',
    'calibrationModelSchema',
    'calibrationSchema',
    'imageryPassDocSchema',
    'passKeyOf',
    'passPrefixOf',
    // M12 (docs/research/M12-own-tiles.md): the own tiles' contracts.
    'IMAGERY_PREVIEW_URL_SECONDS',
    'SIDE_JOB_TYPES',
    'exportTilesPath',
    'imageryPreviewUrlResponseSchema',
    'isSideJob',
    'layerTilesParamsSchema',
    'versionTilesSchema',
    // A photo's date to the day (docs/research/photo-date-source.md).
    'formatPhotoDate',
    'monthNames',
    // M15 (`docs/research/M15-calibration-accuracy.md`, *Joint solve*): the frames a fit was joined to.
    'ALIGNMENT_MAX_PARTNERS',
    'ALIGNMENT_STATUSES',
    'alignedWith',
    'calibrationAlignmentSchema',
    // M15, *Terrain*: the notice a layer fitted over the Copernicus DEM carries, and its map as the layer shows it.
    'DEM_ATTRIBUTION',
    'terrainTransform',
] as const;
