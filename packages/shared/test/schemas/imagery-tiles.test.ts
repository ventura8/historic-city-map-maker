/**
 * The tile layout's contract (`docs/research/M20-import-local.md` §19.10): the golden `layout.json` the pipeline writes, the small
 * Firestore summary, the owner's answer and the wizard's two callables, with their limits and a strict refusal of extra fields.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { imageryAcceptLayoutRequestSchema, imagerySaveLayoutRequestSchema } from '../../src/api/imagery-tiles.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import {
    LAYOUT_SHEETS_MAX,
    LAYOUT_WEAK_SEAMS_MAX,
    layoutAnswerSchema,
    layoutFileSchema,
    stitchLayoutSchema,
    type LayoutFile,
} from '../../src/schemas/imagery-tiles.js';
import { validate } from '../../src/schemas/validation.js';

const CONTRACTS = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts');
const SAMPLE = JSON.parse(readFileSync(resolve(CONTRACTS, 'layout.sample.json'), 'utf8')) as LayoutFile;
/** What the pipeline really writes for a synthetic series (`pipeline/tests/unit/test_placing_layout_contract.py`). */
const WRITTEN = JSON.parse(readFileSync(resolve(CONTRACTS, 'layout.json'), 'utf8')) as {
    readonly layout: LayoutFile;
    readonly summary: unknown;
};
const SHEET = { index: 0, row: 0, col: 1, turn: 90, flip: false };
const SEAM = { a: 0, b: 1, side: 'right', points: { a: [10, 20], b: [3, 21] } };
const BODY = { revision: 2, sheets: [SHEET], seams: [SEAM], preview: true };
const REQUEST = { cityId: 'bucharest', versionId: 'ar-mw993zri-s-4054e55659a3', ...BODY };

describe('layout.json', () => {
    it('happyPath_theGoldenLayoutPasses', () => {
        const result = validate(layoutFileSchema, SAMPLE);

        expect(result.ok ? [] : result.issues).toEqual([]);
    });

    it('happyPath_theLayoutAndSummaryThePipelineWritesPass', () => {
        const layout = validate(layoutFileSchema, WRITTEN.layout);
        const summary = validate(stitchLayoutSchema, WRITTEN.summary);

        expect(layout.ok ? [] : layout.issues).toEqual([]);
        expect(summary.ok ? [] : summary.issues).toEqual([]);
        // The written series holds the cases the wizard reads: a sheet left out, a strong seam and missing seams.
        expect(WRITTEN.layout.sheets.some((sheet) => typeof sheet.out === 'string')).toBe(true);
        expect(new Set(WRITTEN.layout.seams.map((seam) => seam.state))).toEqual(new Set(['strong', 'missing']));
    });

    it('badPath_aWrittenLayoutWithAFieldTheSchemaDoesNotKnowIsRefused', () => {
        expect(validate(layoutFileSchema, { ...WRITTEN.layout, sheets: [{ ...WRITTEN.layout.sheets[0], extra: 1 }] }).ok).toBe(false);
    });

    it('badPath_aTurnThatIsNotAQuarterIsRefused', () => {
        const sheets = [{ ...SAMPLE.sheets[0], turn: 45 }, ...SAMPLE.sheets.slice(1)];

        expect(validate(layoutFileSchema, { ...SAMPLE, sheets }).ok).toBe(false);
    });

    it('badPath_anUnknownSeamStateAndAnExtraFieldAreRefused', () => {
        const seams = [{ ...SAMPLE.seams[0], state: 'maybe' }];

        expect(validate(layoutFileSchema, { ...SAMPLE, seams }).ok).toBe(false);
        expect(validate(layoutFileSchema, { ...SAMPLE, extra: 1 }).ok).toBe(false);
    });
});

describe('help.stitched.layout', () => {
    const summary = { rows: 2, cols: 2, revision: 2, quality: SAMPLE.quality, weakSeams: [] };

    it('happyPath_theSummaryPasses', () => {
        expect(validate(stitchLayoutSchema, summary).ok).toBe(true);
    });

    it('badPath_tooManyWeakSeamsAreRefused', () => {
        const weakSeams = Array.from({ length: LAYOUT_WEAK_SEAMS_MAX + 1 }, () => ({ a: 0, b: 1, side: 'right', score: 0.1 }));

        expect(validate(stitchLayoutSchema, { ...summary, weakSeams }).ok).toBe(false);
    });

    it('happyPath_aWeakSeamOfTheLargestRealSeriesPasses', () => {
        // The harti.zip 1:500 grid has 4,534 sheets; its Fix the tiles run failed at 2,000 (LESSONS 752).
        const weakSeams = [{ a: 4532, b: 4533, side: 'right', score: 0.1 }];

        expect(validate(stitchLayoutSchema, { ...summary, weakSeams }).ok).toBe(true);
    });
});

describe('the owner answer', () => {
    it('happyPath_theSaveAndAcceptRequestsPass', () => {
        expect(validate(imagerySaveLayoutRequestSchema, REQUEST).ok).toBe(true);
        expect(validate(imageryAcceptLayoutRequestSchema, { cityId: 'bucharest', versionId: REQUEST.versionId, revision: 2 }).ok).toBe(
            true,
        );
    });

    it('happyPath_theStoredAnswerCarriesWhoAndWhen', () => {
        const stored = { ...BODY, accepted: true, by: 'u-admin', at: timestampFromDate(new Date('2026-11-12T08:00:00Z')) };

        expect(validate(layoutAnswerSchema, stored).ok).toBe(true);
    });

    it('badPath_onlyNotPartMarksASheetOut', () => {
        expect(validate(imagerySaveLayoutRequestSchema, { ...REQUEST, sheets: [{ ...SHEET, out: 'blank' }] }).ok).toBe(false);
    });

    it('badPath_aSheetIndexBeyondTheLimitIsRefused', () => {
        expect(validate(imagerySaveLayoutRequestSchema, { ...REQUEST, sheets: [{ ...SHEET, index: LAYOUT_SHEETS_MAX }] }).ok).toBe(false);
    });
});
