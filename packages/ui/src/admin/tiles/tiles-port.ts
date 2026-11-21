/**
 * The tile-import wizard's port (`#/help/<versionId>/tiles`, `docs/research/M20-import-local.md` §19.11): what
 * `packages/admin/src/tiles/` gives `<hcm-tiles-page>`. An archive series waiting with `layout-check` shows its sheets in their
 * inferred grid (step 1), its weak seams one at a time (step 2), the layout from its thumbnails and then the pipeline's real preview
 * with the quality meter (step 3), and the hand-off to the georeferencer (step 4). Every value is data; the page binds it as text.
 */
import type { ApiErrorCode, LeftOutReason, SheetSource, StitchVerdict } from '@hcm/shared';

export const TILE_STEPS = ['order', 'seams', 'preview', 'points'] as const;

export type TileStepPort = (typeof TILE_STEPS)[number];

/** A rectangle in pixels: x, y, width, height. */
export type TileRectPort = readonly [number, number, number, number];

/** A point in an oriented sheet's pixels. */
export type TilePointPort = readonly [number, number];

/** One sheet as the grid shows it. */
export interface TileSheetPort {
    /** Its index in `layout.json`, which names its thumbnail in the sprite. */
    readonly index: number;
    readonly name: string;
    readonly row: number;
    readonly col: number;
    readonly turn: 0 | 90 | 180 | 270;
    readonly flip: boolean;
    /** Why it is not in the grid (null: it is). */
    readonly out: LeftOutReason | null;
    readonly source: SheetSource;
    /** Its thumbnail in `thumbs.jpg`, as stored (no turn, no flip), in the sprite's pixels. */
    readonly thumb: TileRectPort;
}

/** One weak seam as step 2 shows it. */
export interface TileSeamPort {
    readonly a: number;
    readonly b: number;
    readonly side: 'right' | 'below';
    readonly nameA: string;
    readonly nameB: string;
    readonly score: number;
    /** Its two strips in `seams.jpg`'s pixels, and the rectangles they show in each oriented sheet. */
    readonly strips: {
        readonly a: { readonly sprite: TileRectPort; readonly sheet: TileRectPort };
        readonly b: { readonly sprite: TileRectPort; readonly sheet: TileRectPort };
    } | null;
    /** The pipeline's guess (null: none). */
    readonly suggestion: { readonly a: TilePointPort; readonly b: TilePointPort } | null;
    /** The owner's points so far, and whether the seam is answered. */
    readonly picked: { readonly a: TilePointPort | null; readonly b: TilePointPort | null };
    readonly answered: boolean;
}

/** The series' quality, as the pipeline measured it, and the thresholds of a good one. */
export interface TileQualityPort {
    readonly placedPct: number;
    readonly seamMedian: number;
    readonly seamRmsPx: number;
    readonly verdict: StitchVerdict;
}

export interface TilesViewState {
    readonly versionId: string;
    /** `moved`: the version exists but waits for no tiles (handed off, or another wait). */
    readonly status: 'loading' | 'ready' | 'error' | 'notFound' | 'moved';
    readonly step: TileStepPort;
    readonly rows: number;
    readonly cols: number;
    readonly revision: number;
    readonly sheets: readonly TileSheetPort[];
    /** The chosen cell (the roving focus of step 1). */
    readonly selected: { readonly row: number; readonly col: number };
    readonly seams: readonly TileSeamPort[];
    /** The seam step 2 shows. */
    readonly seam: number;
    /** `blob:` addresses of `thumbs.jpg`, `seams.jpg` and the stitched preview, and the sprites' sizes in pixels (null: none). */
    readonly thumbs: { readonly url: string; readonly width: number; readonly height: number } | null;
    readonly seamsSprite: { readonly url: string; readonly width: number; readonly height: number } | null;
    readonly stitched: string | null;
    readonly quality: TileQualityPort | null;
    /** The real preview was asked for and the pipeline has not answered yet. */
    readonly previewing: boolean;
    /** The layout was accepted: the series goes on to the georeferencer. */
    readonly handedOff: boolean;
    readonly busy: boolean;
    /** The owner changed the layout since the pipeline last wrote it. */
    readonly dirty: boolean;
    /** The last refusal (a stale revision, the server unreachable), shown on the page. */
    readonly refusal: { readonly key: ApiErrorCode; readonly params?: Readonly<Record<string, string>> } | null;
}

export interface TilesIntentsPort {
    goTo(step: TileStepPort): void;
    /** Chooses a cell (the arrows). */
    select(row: number, col: number): void;
    /** Moves the chosen cell's sheet one cell (Shift and the arrows); the sheet there takes its place. */
    shift(rows: number, cols: number): void;
    /** Drops a sheet on a cell (a drag); the sheet there takes its place. */
    place(index: number, row: number, col: number): void;
    /** The chosen cell's sheet: a quarter turn clockwise (R), mirrored (F), out of the map (X). */
    rotate(): void;
    flip(): void;
    takeOut(): void;
    /** Puts a sheet left out back in the first empty cell. */
    putBack(index: number): void;
    /** Step 2: the guess accepted (Enter), a point clicked on one strip, the next seam (N). */
    acceptSeam(): void;
    pick(side: 'a' | 'b', point: TilePointPort): void;
    nextSeam(): void;
    /** Step 3: the owner's layout sent for the pipeline's real preview. */
    preview(): Promise<void>;
    /** Step 4: the layout accepted, the series sent on to points. */
    handOff(): Promise<void>;
    retry(): void;
}
