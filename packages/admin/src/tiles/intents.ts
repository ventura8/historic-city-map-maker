/**
 * The tile-import wizard's edits (`TilesIntentsPort` of `@hcm/ui/admin`): each one changes the draft's sheets or seams through the
 * pure functions of `draft.ts` and `seams.ts`; the store (`tiles.ts`) keeps the draft and the page's view in step.
 */
import type { TilePointPort, TilesIntentsPort, TilesViewState, TileStepPort } from '@hcm/ui/admin';

import {
    carriedShift,
    changeAt,
    mirrored,
    notPart,
    placeAt,
    putBack,
    stepFrom,
    turned,
    type Carry,
    type DraftSheet,
    type Grid,
} from './draft.js';
import { canResize, reflowed } from './grid.js';
import { acceptGuess, pickPoint, type DraftSeam } from './seams.js';

/** What the edits need of the store. */
export interface TilesHost {
    readonly state: TilesViewState;
    readonly sheets: readonly DraftSheet[];
    readonly seams: readonly DraftSeam[];
    setSheets(sheets: readonly DraftSheet[], selected?: { readonly row: number; readonly col: number }): void;
    setSeams(seams: readonly DraftSeam[]): void;
    setGrid(grid: Grid): void;
    update(patch: Partial<TilesViewState>): void;
    preview(): Promise<void>;
    handOff(): Promise<void>;
    retry(): void;
}

function grid(state: TilesViewState): { readonly rows: number; readonly cols: number } {
    return { rows: state.rows, cols: state.cols };
}

function sheetEdits(host: TilesHost): Pick<TilesIntentsPort, 'select' | 'shift' | 'place' | 'rotate' | 'flip' | 'takeOut' | 'putBack'> {
    // The sheet carried by Shift and the arrows, while nothing else changed the sheets.
    let carry: Carry | null = null;
    const at = (change: (sheet: DraftSheet) => Partial<DraftSheet>): void => {
        host.setSheets(changeAt(host.sheets, host.state.selected, change));
    };
    return {
        select: (row, col) => {
            host.update({ selected: stepFrom({ row, col }, 0, 0, grid(host.state)) });
        },
        shift: (rows, cols) => {
            const target = stepFrom(host.state.selected, rows, cols, grid(host.state));
            const shifted = carriedShift(host.sheets, carry, host.state.selected, target);
            carry = shifted.carry;
            host.setSheets(shifted.sheets, target);
        },
        place: (index, row, col) => {
            const target = stepFrom({ row, col }, 0, 0, grid(host.state));
            host.setSheets(placeAt(host.sheets, index, target), target);
        },
        rotate: () => {
            at(turned);
        },
        flip: () => {
            at(mirrored);
        },
        takeOut: () => {
            at(notPart);
        },
        putBack: (index) => {
            host.setSheets(putBack(host.sheets, index, grid(host.state)));
        },
    };
}

function gridEdits(host: TilesHost): Pick<TilesIntentsPort, 'resize' | 'reflow'> {
    return {
        resize: (rows, cols) => {
            const next = { rows: host.state.rows + Math.sign(rows), cols: host.state.cols + Math.sign(cols) };
            if (canResize(host.sheets, next)) {
                host.setGrid(next);
            }
        },
        reflow: (cols) => {
            const laid = reflowed(host.sheets, cols);
            if (laid !== null) {
                host.setSheets(laid.sheets, { row: 0, col: 0 });
                host.setGrid(laid.grid);
            }
        },
    };
}

function seamEdits(host: TilesHost): Pick<TilesIntentsPort, 'acceptSeam' | 'pick' | 'nextSeam'> {
    return {
        acceptSeam: () => {
            host.setSeams(acceptGuess(host.seams, host.state.seam));
        },
        pick: (side: 'a' | 'b', point: TilePointPort) => {
            host.setSeams(pickPoint(host.seams, host.state.seam, side, point));
        },
        nextSeam: () => {
            const count = host.seams.length;
            host.update({ seam: count === 0 ? 0 : (host.state.seam + 1) % count });
        },
    };
}

export function tilesIntentsOf(host: TilesHost): TilesIntentsPort {
    return {
        goTo: (step: TileStepPort) => {
            host.update({ step });
        },
        ...sheetEdits(host),
        ...gridEdits(host),
        ...seamEdits(host),
        preview: () => host.preview(),
        handOff: () => host.handOff(),
        retry: () => {
            host.retry();
        },
    };
}
