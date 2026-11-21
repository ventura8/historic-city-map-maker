/** A new version's label and year (`docs/research/M3-interfaces.md` §4.1): from a scene's camera and date, or an upload's name. */
import { describe, expect, it } from 'vitest';

import { frameLabel, layerLabelFor, tooCoarseForStreets, uploadLabelFor, uploadYearOf, yearOfDate } from '../../src/imagery/labels.js';

describe('layerLabelFor', () => {
    it.each([
        ['KH-4A', '1966-07-12', 'KH-4A Corona, 12 iulie 1966', 'KH-4A Corona, 12 July 1966'],
        ['KH-9-mapping', '1978-03-30', 'KH-9 Hexagon (mapping camera), 30 martie 1978', 'KH-9 Hexagon (mapping camera), 30 March 1978'],
        ['KH-9-pan', '1980-01-06', 'KH-9 Hexagon, 6 ianuarie 1980', 'KH-9 Hexagon, 6 January 1980'],
        ['KH-7', '1967-12-31', 'KH-7 Gambit, 31 decembrie 1967', 'KH-7 Gambit, 31 December 1967'],
    ] as const)('happyPath_%s_%s', (sensor, date, ro, en) => {
        expect(layerLabelFor(sensor, date)).toEqual({ ro, en });
    });

    it('happyPath_theYearIsTheDatesFirstFourDigits', () => {
        expect(yearOfDate('1977-09-13')).toBe(1977);
    });
});

describe('uploads', () => {
    it('happyPath_theLabelIsTheFileNameWithoutItsExtension', () => {
        expect(uploadLabelFor('Planul Borroczyn 1852.tif', 'raster')).toEqual({ ro: 'Planul Borroczyn 1852' });
    });

    it.each([
        ['no name', undefined],
        ['a name that is only an extension', '   .tif'],
    ])('badPath_withoutANameTheFallbackIsUsed_%s', (_case, name) => {
        expect(uploadLabelFor(name, 'up-1')).toEqual({ ro: 'up-1' });
    });

    it('happyPath_aLongNameIsCutTo200Characters', () => {
        expect(uploadLabelFor(`${'x'.repeat(250)}.tif`, 'up-1').ro).toHaveLength(200);
    });

    it.each([
        ['the metadata year wins', '1911', 'Plan 1852.tif', 1911],
        ['else the name says it', undefined, 'Plan 1852.tif', 1852],
        ['a metadata year out of range falls back to the name', '1700', 'Plan 1852.tif', 1852],
        ['nothing says it', undefined, 'Plan.tif', undefined],
        ['no name and no year', undefined, undefined, undefined],
    ])('uploadYearOf_%s', (_case, metadataYear, name, expected) => {
        expect(uploadYearOf(metadataYear, name)).toBe(expected);
    });
});

describe('an Argon frame (admin sweep 2026-11-14)', () => {
    it('happyPath_anArgonFrameImportedAsCoronaIsNamedArgonItsDateKept', () => {
        expect(frameLabel({ ro: 'KH-4A Corona, 21 august 1963' }, 'DS09059A041MC015')).toEqual({ ro: 'KH-5 Argon, 21 august 1963' });
        expect(tooCoarseForStreets(['DS09059A041MC015'], 'KH-4A')).toBe(true);
        expect(tooCoarseForStreets([], 'KH-5')).toBe(true);
    });

    it('badPath_anyOtherFrameKeepsItsLabelAndIsNotTooCoarse', () => {
        const label = { ro: 'KH-4B Corona, 5 mai 1968', en: 'KH-4B Corona, 5 May 1968' };
        expect(frameLabel(label, 'DS1103-1058DF027')).toBe(label);
        expect(frameLabel(label, undefined)).toBe(label);
        expect(tooCoarseForStreets(['DS1103-1058DF027'], 'KH-4B')).toBe(false);
        expect(tooCoarseForStreets([], undefined)).toBe(false);
    });
});
