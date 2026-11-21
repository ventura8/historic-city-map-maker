/** The tile-import wizard's draft (`docs/research/M20-import-local.md` §19.11): moving, turning, taking out and answering sheets and seams. */
import { layoutFileSchema, validate, type LayerVersionDoc, type LayoutFile } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    changeAt,
    firstEmpty,
    mirrored,
    notPart,
    ownerSheetsOf,
    placeAt,
    placedCount,
    putBack,
    sheetAt,
    sheetsOf,
    shiftFrom,
    stepFrom,
    thumbOf,
    thumbSpriteOf,
    turned,
} from '../../src/tiles/draft.js';
import { acceptGuess, ownerSeamsOf, pickPoint, seamsAfter, seamSpriteOf, spriteRectOf, weakSeamsOf } from '../../src/tiles/seams.js';
import { versionViewOf } from '../../src/imagery/version-view.js';
import { seamPortOf } from '../../src/tiles/view.js';
import { golden } from '../imagery/world.js';

function sample(): LayoutFile {
    const result = validate(layoutFileSchema, golden('layout.sample.json'));
    if (!result.ok) {
        throw new Error('the golden layout no longer passes');
    }
    return result.value;
}

const GRID = { rows: 2, cols: 2 };

describe('the draft of the sheets', () => {
    it('happyPath_aDropSwapsTwoPlacedSheetsAndMarksThemTheOwners', () => {
        const sheets = placeAt(sheetsOf(sample()), 0, { row: 0, col: 1 });
        expect(sheetAt(sheets, { row: 0, col: 1 })).toMatchObject({ index: 0, source: 'owner' });
        expect(sheetAt(sheets, { row: 0, col: 0 })).toMatchObject({ index: 1, source: 'owner' });
    });

    it('badPath_aLeftOutSheetDoesNotLandOnAnotherAndAMissingOneMovesNothing', () => {
        const sheets = sheetsOf(sample());
        expect(placeAt(sheets, 4, { row: 0, col: 0 })).toBe(sheets);
        expect(placeAt(sheets, 99, { row: 0, col: 0 })).toBe(sheets);
        expect(placeAt(sheets, 0, { row: 0, col: 0 })).toBe(sheets);
    });

    it('happyPath_shiftTurnMirrorAndTakeOut', () => {
        const start = sheetsOf(sample());
        const target = stepFrom({ row: 0, col: 0 }, 5, -3, GRID);
        expect(target).toEqual({ row: 1, col: 0 });
        const shifted = shiftFrom(start, { row: 0, col: 0 }, target);
        expect(sheetAt(shifted, target)?.index).toBe(0);
        expect(shiftFrom(start, { row: 5, col: 5 }, target)).toBe(start);
        const turnedOnce = changeAt(start, { row: 0, col: 0 }, turned);
        expect(sheetAt(turnedOnce, { row: 0, col: 0 })).toMatchObject({ turn: 90, width: 2000, height: 3000 });
        const turnedBack = changeAt(start, { row: 1, col: 0 }, turned);
        expect(sheetAt(turnedBack, { row: 1, col: 0 })?.turn).toBe(270);
        expect(sheetAt(changeAt(start, { row: 0, col: 0 }, mirrored), { row: 0, col: 0 })?.flip).toBe(true);
        const out = changeAt(start, { row: 0, col: 0 }, notPart);
        expect(sheetAt(out, { row: 0, col: 0 })).toBeUndefined();
        expect(placedCount(out)).toBe(3);
        expect(changeAt(start, { row: 9, col: 9 }, notPart)).toBe(start);
    });

    it('happyPath_putBackFillsTheFirstEmptyCell', () => {
        const out = changeAt(sheetsOf(sample()), { row: 0, col: 1 }, notPart);
        expect(firstEmpty(out, GRID)).toEqual({ row: 0, col: 1 });
        expect(sheetAt(putBack(out, 1, GRID), { row: 0, col: 1 })?.index).toBe(1);
    });

    it('badPath_aFullGridTakesNothingBack', () => {
        const sheets = sheetsOf(sample());
        expect(firstEmpty(sheets, GRID)).toBeNull();
        expect(putBack(sheets, 4, GRID)).toBe(sheets);
    });

    it('happyPath_theAnswerHoldsThePlacedSheetsAndThoseNotPartOfTheMap', () => {
        const out = changeAt(sheetsOf(sample()), { row: 0, col: 1 }, notPart);
        expect(ownerSheetsOf(out)).toEqual([
            { index: 0, row: 0, col: 0, turn: 0, flip: false },
            { index: 1, row: 0, col: 1, turn: 0, flip: false, out: 'not-part' },
            { index: 2, row: 1, col: 0, turn: 180, flip: false },
            { index: 3, row: 1, col: 1, turn: 0, flip: false },
        ]);
    });

    it('happyPath_aSheetLeftOutForNoSeamIsTriedAgainAtItsFreeCell', () => {
        const file = sample();
        const noSeam = {
            ...file,
            sheets: file.sheets.map((sheet, index) => (index === 3 ? { ...sheet, out: 'no-seam' as const } : sheet)),
        };
        const sheets = sheetsOf(noSeam);
        expect(ownerSheetsOf(sheets).map((sheet) => sheet.index)).toEqual([0, 1, 2, 3]);
        expect(ownerSheetsOf(sheets)[3]).toEqual({ index: 3, row: 1, col: 1, turn: 0, flip: false });
    });

    it('badPath_aSheetLeftOutForNoSeamWhoseCellIsTakenOrABlankPageIsNotNamed', () => {
        const file = sample();
        const noJoin = {
            ...file,
            sheets: file.sheets.map((sheet, index) => (index === 3 ? { ...sheet, out: 'no-join' as const } : sheet)),
        };
        const taken = placeAt(sheetsOf(noJoin), 2, { row: 1, col: 1 });
        expect(ownerSheetsOf(taken).map((sheet) => sheet.index)).toEqual([0, 1, 2]);
    });

    it('happyPath_aThumbnailIsItsSpriteCellAsStored', () => {
        const [first, , third] = sheetsOf(sample());
        expect(first && thumbOf(first)).toEqual([0, 0, 128, 85]);
        expect(third && thumbOf({ ...third, turn: 90, width: 2000, height: 3000 })).toEqual([256, 0, 128, 85]);
        expect(thumbOf({ ...sheetsOf(sample())[0], index: 33 } as never)).toEqual([128, 128, 128, 85]);
        expect(thumbSpriteOf(5)).toEqual({ width: 640, height: 128 });
        expect(thumbSpriteOf(40)).toEqual({ width: 4096, height: 256 });
    });
});

describe('the weak seams', () => {
    it('happyPath_theGuessOrTwoClicksAnswerASeam', () => {
        const seams = weakSeamsOf(sample());
        expect(seams.map((seam) => [seam.a, seam.b, seam.suggestion === null])).toEqual([
            [1, 3, false],
            [2, 3, true],
        ]);
        expect(ownerSeamsOf(seams)).toEqual([]);
        const accepted = acceptGuess(seams, 0);
        expect(ownerSeamsOf(accepted)).toEqual([{ a: 1, b: 3, side: 'below', points: { a: [1500, 1990], b: [1497, 42] } }]);
        const half = pickPoint(seams, 0, 'a', [1, 2]);
        expect(half[0]?.answered).toBe(false);
        expect(ownerSeamsOf(pickPoint(half, 0, 'b', [3, 4]))).toEqual([{ a: 1, b: 3, side: 'below', points: { a: [1, 2], b: [3, 4] } }]);
    });

    it('badPath_aWeakSeamWithoutStripOrGuessIsStillAsked', () => {
        const without = (key: string, value: unknown): unknown => (key === 'strip' || key === 'suggestion' ? undefined : value);
        const bare = JSON.parse(JSON.stringify(sample(), without)) as LayoutFile;
        const seams = weakSeamsOf(bare);
        expect(seams[0]).toMatchObject({ strip: null, suggestion: null });
        const [seam] = seams;
        expect(seam && seamPortOf(seam, [])).toMatchObject({ nameA: '1', nameB: '3', strips: null });
        expect(seamSpriteOf(bare.seams)).toEqual({ width: 512, height: 0 });
    });

    it('happyPath_anAnswerChangesOnlyItsOwnSeam', () => {
        const [seam] = weakSeamsOf(sample());
        const seams = seam === undefined ? [] : [seam, { ...seam, a: 0, b: 2 }];
        const answered = acceptGuess(seams, 1);
        expect(answered.map((one) => one.answered)).toEqual([false, true]);
    });

    it('badPath_aSeamWithoutAGuessStaysUnanswered', () => {
        const seams = weakSeamsOf(sample()).map((seam) => ({ ...seam, suggestion: null }));
        expect(acceptGuess(seams, 0)[0]?.answered).toBe(false);
    });

    it('happyPath_aSeamKeepsWhileItsSheetsStayAndGoesWhenOneChanges', () => {
        const seams = weakSeamsOf(sample());
        const sheets = sheetsOf(sample());
        expect(seamsAfter(seams, sheets, [...sheets])).toBe(seams);
        const mirroredOne = changeAt(sheets, { row: 1, col: 0 }, mirrored);
        expect(seamsAfter(seams, sheets, mirroredOne).map((seam) => [seam.a, seam.b])).toEqual([[1, 3]]);
        const outOne = changeAt(sheets, { row: 1, col: 1 }, notPart);
        expect(seamsAfter(seams, sheets, outOne)).toEqual([]);
    });

    it('happyPath_theStripsSitInTheirSquaresOfTheSprite', () => {
        expect(spriteRectOf(2, 'a', [0, 1500, 3000, 500])).toEqual([0, 512, 256, 43]);
        expect(spriteRectOf(0, 'b', [0, 0, 500, 1000])).toEqual([256, 0, 128, 256]);
        expect(seamSpriteOf(sample().seams)).toEqual({ width: 512, height: 512 });
        expect(seamSpriteOf([])).toEqual({ width: 512, height: 0 });
    });
});

describe("a version's page", () => {
    it('happyPath_aSeriesWaitingForItsTilesOffersTheWizard', () => {
        const stored = { id: 'v', path: 'p', version: '1', pending: false };
        const waiting = golden('version.layout-check.json') as unknown as LayerVersionDoc;
        expect(versionViewOf({ ...stored, data: waiting }).layoutCheck).toBe(true);
        expect(versionViewOf({ ...stored, data: { ...waiting, help: undefined } }).layoutCheck).toBe(false);
    });
});
