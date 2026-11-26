/** The tile-import wizard's texts (`@hcm/shared/admin-tiles`, fetched with the `help` chunk only) and a few shared phrasings. */
import type { UiLocale } from '@hcm/shared';
import { translateAdminTiles, type AdminTilesKey } from '@hcm/shared/admin-tiles';

import type { TileSheetPort } from './tiles-port.js';

export function tilesText(locale: UiLocale, key: AdminTilesKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminTiles(locale, key, params);
}

/** A sheet as a cell names it: its name, turn and mirror, row and column (counted from 1), and where its place came from. */
export function sheetLabel(locale: UiLocale, sheet: TileSheetPort): string {
    const parts = [
        tilesText(locale, 'adminTiles.cellSheet', { name: sheet.name, row: String(sheet.row + 1), col: String(sheet.col + 1) }),
        sheet.turn === 0 ? '' : tilesText(locale, 'adminTiles.turned', { turn: String(sheet.turn) }),
        sheet.flip ? tilesText(locale, 'adminTiles.mirrored') : '',
        tilesText(locale, `adminTiles.source.${sheet.source}`),
    ];
    return parts.filter((part) => part !== '').join(', ');
}
