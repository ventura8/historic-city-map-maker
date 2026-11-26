/**
 * M22 (`docs/research/M22-help-calibrate.md`): what Help calibrate reads and writes on an archive series' version.
 *
 * - `help.stitched` (§4.1, the pipeline): the series' sheets, pages or pieces joined into one picture, the preview the wizard lays over
 *   the map, with the parts left out and why, and the joins' quality.
 */
import { z } from 'zod';

import { LEFT_OUT_REASONS, stitchLayoutSchema } from './imagery-tiles.js';
import { plainText } from './primitives.js';

export { LEFT_OUT_REASONS } from './imagery-tiles.js';

/** How the parts were joined: a grid's names and frames, an atlas's edges or overlaps, pieces' overlaps, one map alone, or the parts laid on
 * the archive's complete overview map (harti.zip, 2026-11-12); the files' names with their seams, or the owner's layout from the
 * tile-import wizard (`imagery-tiles.ts`). */
export const STITCH_METHODS = ['grid', 'atlas', 'pieces', 'single', 'overview', 'names', 'owner'] as const;

/** At most this many left-out parts are named (`leftOutCount` says how many there were). */
export const STITCHED_LEFT_OUT_MAX = 200;

/** The stitched picture's long side at most (the georeferencer's preview size). */
export const STITCHED_PREVIEW_MAX_PX = 4096;

export const stitchedSchema = z.strictObject({
    previewPath: z.string().min(1).max(500),
    /** Preview pixels per stitched pixel (at most 1): a point's preview position is `pixel × previewScale`. */
    previewScale: z.number().positive().max(1),
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    method: z.enum(STITCH_METHODS),
    parts: z.number().int().min(1),
    joined: z.number().int().min(0),
    leftOut: z.array(z.strictObject({ name: plainText(200), reason: z.enum(LEFT_OUT_REASONS) })).max(STITCHED_LEFT_OUT_MAX),
    leftOutCount: z.number().int().min(0),
    /** Ground metres per stitched pixel when known (a grid's mosaic). */
    metresPerPx: z.number().positive().optional(),
    joins: z.strictObject({ links: z.number().int().min(0), meanInliers: z.number().min(0), rmsPx: z.number().min(0) }).optional(),
    /** The tile layout (`imagery-tiles.ts`): the grid, its revision, its quality and its weakest seams; `layout.json` has the rest. */
    layout: stitchLayoutSchema.optional(),
});

export type Stitched = z.infer<typeof stitchedSchema>;

/** What `restitchable` reads of a version. */
export interface RestitchInput {
    readonly origin?: string | undefined;
    readonly state: string;
    readonly help?: { readonly reason?: string; readonly stitched?: Pick<Stitched, 'method' | 'leftOutCount'> | undefined } | undefined;
}

/** Pieces left out of an overview mosaic. */
function leftOutOfOverview(stitched: Pick<Stitched, 'method' | 'leftOutCount'> | undefined): boolean {
    return stitched?.method === 'overview' && stitched.leftOutCount > 0;
}

/**
 * M20 (DECISIONS-for-review.md §216): a published archive series with pieces left out of its overview mosaic, which Locate again lays
 * on the overview again in a new version of its layer. Shared by `imagery.locateAgain` (`restitch.ts`) and the admin's version view.
 */
export function restitchable(version: RestitchInput): boolean {
    return version.origin === 'archive' && version.state === 'published' && leftOutOfOverview(version.help?.stitched);
}

/** The states of an archive series that **Fix the tiles** reopens: on the map, or waiting for its approval. */
const RELAYOUT_STATES: ReadonlySet<string> = new Set(['published', 'awaiting_approval']);

/** Parked for points (low confidence, "states no scale", ...), not for its tiles: the tile wizard is not open to it. */
function parkedForPoints(version: Pick<RestitchInput, 'state' | 'help'>): boolean {
    return version.state === 'needs_gcps' && version.help?.reason !== 'layout-check';
}

/**
 * M20 §19.13 (2026-11-21, the 1:500 of 1960-71 published with gaps and sheets off): an archive series on the map, waiting for its
 * approval or parked for points (§19.17: `ar-mw993zri-s-890875e3ff8d`, "states no scale", promised Fix the tiles and had none), which
 * **Fix the tiles** lays out again in a new version of its layer (`functions/src/imagery/relayout.ts`). A series parked for its tiles
 * (`layout-check`) opens Arrange the tiles instead.
 */
export function relayoutable(version: Pick<RestitchInput, 'origin' | 'state' | 'help'>): boolean {
    return version.origin === 'archive' && (RELAYOUT_STATES.has(version.state) || parkedForPoints(version));
}

/** What `helpFlagsOf` answers. */
export interface HelpFlags {
    readonly layoutCheck: boolean;
    readonly restitchable: boolean;
    readonly relayoutable: boolean;
}

/**
 * What a version's page offers from its `help`: the tile-import wizard for a series waiting with `layout-check` (M20 §19), Locate
 * again for a series to stitch again (`restitchable`) and Fix the tiles (`relayoutable`). Kept here, out of the admin's Imagery chunk
 * (its 18 KB budget).
 */
export function helpFlagsOf(version: RestitchInput): HelpFlags {
    const layoutCheck = version.state === 'needs_gcps' && version.help?.reason === 'layout-check';
    return { layoutCheck, restitchable: restitchable(version), relayoutable: relayoutable(version) };
}
