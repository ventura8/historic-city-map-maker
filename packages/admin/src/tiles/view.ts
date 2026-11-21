/**
 * The tile-import wizard's view (`TilesViewState` of `@hcm/ui/admin`): the draft's sheets and seams as the page shows them, the
 * sprites' sizes and the state before anything is read.
 */
import type { TileSeamPort, TileSheetPort, TilesViewState } from '@hcm/ui/admin';

import { thumbOf, type DraftSheet } from './draft.js';
import { spriteRectOf, type DraftSeam } from './seams.js';

export const INITIAL_TILES: TilesViewState = {
    versionId: '',
    status: 'loading',
    step: 'order',
    rows: 1,
    cols: 1,
    revision: 0,
    sheets: [],
    selected: { row: 0, col: 0 },
    seams: [],
    seam: 0,
    thumbs: null,
    seamsSprite: null,
    stitched: null,
    quality: null,
    previewing: false,
    handedOff: false,
    busy: false,
    dirty: false,
    refusal: null,
};

export function sheetPortOf(sheet: DraftSheet): TileSheetPort {
    const { index, name, row, col, turn, flip, out, source } = sheet;
    return { index, name, row, col, turn, flip, out, source, thumb: thumbOf(sheet) };
}

function stripsOf(seam: DraftSeam): TileSeamPort['strips'] {
    const strip = seam.strip;
    return strip === null
        ? null
        : {
              a: { sprite: spriteRectOf(strip.row, 'a', strip.a), sheet: strip.a },
              b: { sprite: spriteRectOf(strip.row, 'b', strip.b), sheet: strip.b },
          };
}

export function seamPortOf(seam: DraftSeam, sheets: readonly DraftSheet[]): TileSeamPort {
    const nameOf = (index: number): string => sheets.find((sheet) => sheet.index === index)?.name ?? String(index);
    const { a, b, side, score, suggestion, picked, answered } = seam;
    return { a, b, side, score, suggestion, picked, answered, nameA: nameOf(a), nameB: nameOf(b), strips: stripsOf(seam) };
}
