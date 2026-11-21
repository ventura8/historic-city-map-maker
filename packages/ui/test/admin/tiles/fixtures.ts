/** The tile-import wizard's views for its browser tests: a 2 × 2 series with one sheet left out and one weak seam. */
import type { TileSeamPort, TileSheetPort, TilesViewState } from '../../../src/admin/tiles/tiles-port.js';

/** A one-pixel grey JPEG-like image as a data address (the page only binds it). */
const SPRITE = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

function sheet(index: number, row: number, col: number, more: Partial<TileSheetPort> = {}): TileSheetPort {
    return {
        ...{ index, name: `r${String(row + 1)}c${String(col + 1)}.jpg`, row, col, turn: 0, flip: false, out: null, source: 'name' },
        thumb: [index * 128, 0, 128, 85],
        ...more,
    };
}

export const SEAM: TileSeamPort = {
    a: 0,
    b: 1,
    side: 'right',
    nameA: 'r1c1.jpg',
    nameB: 'r1c2.jpg',
    score: 0.2,
    strips: { a: { sprite: [0, 0, 64, 256], sheet: [2250, 0, 750, 3000] }, b: { sprite: [256, 0, 64, 256], sheet: [0, 0, 750, 3000] } },
    suggestion: { a: [2900, 1500], b: [100, 1500] },
    picked: { a: null, b: null },
    answered: false,
};

export function tilesView(overrides: Partial<TilesViewState> = {}): TilesViewState {
    return {
        versionId: 'ar-mw993zri-s-4054e55659a3',
        status: 'ready',
        step: 'order',
        rows: 2,
        cols: 2,
        revision: 2,
        sheets: [
            sheet(0, 0, 0),
            sheet(1, 0, 1, { turn: 90, flip: true, source: 'seam' }),
            sheet(2, 1, 0, { source: 'order' }),
            sheet(3, 0, 0, { out: 'blank', name: 'blank.jpg' }),
        ],
        selected: { row: 0, col: 0 },
        seams: [SEAM],
        seam: 0,
        thumbs: { url: SPRITE, width: 512, height: 128 },
        seamsSprite: { url: SPRITE, width: 512, height: 256 },
        stitched: SPRITE,
        quality: { placedPct: 75, seamMedian: 0.31, seamRmsPx: 6.5, verdict: 'check' },
        previewing: false,
        handedOff: false,
        busy: false,
        dirty: false,
        refusal: null,
        ...overrides,
    };
}
