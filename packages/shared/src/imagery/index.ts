/** The M3 imagery helpers both the functions and the admin use (`docs/research/M3-interfaces.md` §3.2, §3.3, §4.1). */
export { MAX_FOOTPRINT_VERTICES, footprintCoverage, footprintOf } from './coverage.js';
export type { FootprintVertex, FrameCamera } from './coverage.js';
export { planDate, planDates } from './join.js';
export type { DatePlanFrame } from './join.js';
export { ARGON_FRAME_ID, frameLabel, layerLabelFor, tooCoarseForStreets, uploadLabelFor, uploadYearOf, yearOfDate } from './labels.js';
export type { LayerLabel } from './labels.js';
export { rankScene } from './ranking.js';
export type { RankContext, RankedScene } from './ranking.js';
