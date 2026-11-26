import { describe, expect, it } from 'vitest';

import { createIdAllocator, fileStem, isCameraName, MAX_ID_LENGTH, slugify, truncateSlug, uniqueIds } from '../../src/migration/slug.js';
import { parseLegacyYear, yearIn } from '../../src/migration/year.js';

describe('parseLegacyYear', () => {
    it.each([
        [1980, 'x.jpg', { year: 1980 }],
        ['1960', 'x.jpg', { year: 1960 }],
        [' 1936 ', 'x.jpg', { year: 1936 }],
        ['Iulie 1936', 'obor-29-iulie-1936-3.jpg', { year: 1936, dateText: 'Iulie 1936' }],
        ['', 'Arionoaia 1978.jpg', { year: 1978 }],
        [undefined, 'Intrarea Antim 1982.jpg', { year: 1982 }],
        ['', 'Uranus spre Izvor Colt 13 Septembrie - Cazarmi 1982.jpg', { year: 1982 }],
        ['circa', 'REALITATEA-ILUSTRATA-1934-6.1.jpg', { year: 1934 }],
    ])('happyPath_%j_in_%s', (value, fileName, expected) => {
        expect(parseLegacyYear(value, fileName)).toEqual(expected);
    });

    it.each([
        [1700, 'Mihai Voda.jpg'],
        [1980.5, 'Mihai Voda.jpg'],
        ['', 'Mihai Voda.jpg'],
        [null, 'photo-12345.jpg'],
        ['', 'nr 63 si 61.jpg'],
    ])('badPath_%j_in_%s_hasNoYear', (value, fileName) => {
        expect(parseLegacyYear(value, fileName)).toEqual({});
    });

    it('happyPath_aBadNumberFallsBackToTheFileName', () => {
        expect(parseLegacyYear(3000, 'Ecoului 1978.jpg')).toEqual({ year: 1978 });
    });

    it.each([
        ['x 2100 y', 2100],
        ['21000', undefined],
        ['a1999b', 1999],
    ])('happyPath_yearIn_%s', (text, expected) => {
        expect(yearIn(text)).toBe(expected);
    });
});

describe('slugs and ids', () => {
    it.each([
        ['Mihai Voda, nr 63 si 61 spre strada Al Orascu.jpg', 'Mihai Voda, nr 63 si 61 spre strada Al Orascu'],
        ['REALITATEA-ILUSTRATA-1934-6.1.jpg', 'REALITATEA-ILUSTRATA-1934-6.1'],
        ['archive.tar.gz', 'archive.tar'],
        ['no-extension', 'no-extension'],
        ['.hidden', '.hidden'],
        ['odd.extension-too-long', 'odd.extension-too-long'],
    ])('happyPath_fileStem_%s', (name, expected) => {
        expect(fileStem(name)).toBe(expected);
    });

    it.each([
        ['Ștrandul Operetă (1976)', 'strandul-opereta-1976'],
        ['  Intrarea in fabrica Luceafarul (Nufarul) ', 'intrarea-in-fabrica-luceafarul-nufarul'],
        ['REALITATEA-ILUSTRATA-1934-6.1', 'realitatea-ilustrata-1934-6-1'],
        ['!!!', ''],
    ])('happyPath_slugify_%s', (text, expected) => {
        expect(slugify(text)).toBe(expected);
    });

    it('happyPath_truncatesAtAWordBoundary', () => {
        expect(truncateSlug('al-orascu-vazuta-din-mihai-voda-partea-din-dreapta', 40)).toBe('al-orascu-vazuta-din-mihai-voda-partea');
        expect(truncateSlug('x'.repeat(50), 40)).toBe('x'.repeat(40));
        expect(truncateSlug('short', 40)).toBe('short');
    });

    it('happyPath_collisionsGetSuffixesInOrder', () => {
        expect(uniqueIds(['a', 'b', 'a', 'a', '', ''])).toEqual(['a', 'b', 'a-2', 'a-3', 'photo', 'photo-2']);
    });

    it('happyPath_suffixedIdsStayWithinTheLimit', () => {
        const base = 'al-orascu-vazuta-din-mihai-voda-partea-din-dreapta';
        const ids = uniqueIds([base, base, ...Array.from({ length: 9 }, () => base)]);

        expect(ids.slice(0, 2)).toEqual(['al-orascu-vazuta-din-mihai-voda-partea', 'al-orascu-vazuta-din-mihai-voda-partea-2']);
        expect(ids.at(-1)).toBe('al-orascu-vazuta-din-mihai-voda-11');
        expect(ids.every((id) => id.length <= MAX_ID_LENGTH)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('happyPath_eachAllocatorHasItsOwnMemory', () => {
        const first = createIdAllocator();
        const second = createIdAllocator();

        expect([first('x'), first('x'), second('x')]).toEqual(['x', 'x-2', 'x']);
    });

    it('badPath_aReservedIdIsNeverHandedOut', () => {
        // The ids of an earlier migration the new photos join (seed/bucharest-2023 after seed/bucharest).
        const next = createIdAllocator(['gara-obor', 'x', 'x-2']);

        expect([next('gara-obor'), next('x'), next('la-leu')]).toEqual(['gara-obor-2', 'x-3', 'la-leu']);
    });
});

describe('isCameraName', () => {
    it.each(['IMG_0412', 'IMG 0412', 'DSC00042', 'PXL_20261024', ' Scan 3', 'dji-0007'])('happyPath_%j_isACamerasNaming', (stem) => {
        expect(isCameraName(stem)).toBe(true);
    });

    it.each(['Ateneul Român', 'Calea Victoriei 1977', 'Imagine veche', ''])('badPath_%j_isATitle', (stem) => {
        expect(isCameraName(stem)).toBe(false);
    });
});
