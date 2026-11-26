import { describe, expect, it } from 'vitest';

import { areaIssues, boundsGrow, contentOutside, roundedBounds, viewFields } from '../../src/settings/area.js';
import {
    ascendingOrderChanges,
    canAdd,
    categoryIssues,
    categoryItemOf,
    deletionBatches,
    inOrder,
    isBundledIcon,
    newCategory,
    newCategoryId,
} from '../../src/settings/categories.js';
import { contrast, isHex, luminance, nearestTone, normalizeHex, readsWithWhite, withLightness } from '../../src/settings/colour.js';
import { textOf, withOptionalText, withText } from '../../src/settings/localized.js';
import { settingsRoute } from '../../src/settings/sections.js';
import { basemapChoiceOf, basemapFor, contrastPasses, seedTheme, SEED_PRESETS, tokensOf } from '../../src/settings/theme.js';
import {
    creditIssue,
    editedCredit,
    editedCredits,
    movedCredit,
    rejectedLinkLines,
    withCredit,
    withoutCredit,
} from '../../src/settings/texts.js';
import { CATEGORY_PATH, categoryDoc, cityDoc, photoDoc, poiDoc } from '../layers/fixtures.js';

const BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };

describe('the area', () => {
    it('happyPath_useThisViewRoundsTheMapsView', () => {
        expect(viewFields({ center: [26.123456789, 44.987654321], zoom: 13.456 })).toEqual({
            center: { lat: 44.9876543, lng: 26.1234568 },
            zoom: 13.46,
        });
        expect(roundedBounds({ west: 25.123456789, south: 1, east: 2, north: 3 })).toEqual({
            west: 25.1234568,
            south: 1,
            east: 2,
            north: 3,
        });
    });

    it('badPath_zoomsOutOfOrderAndACentreOutsideAreNamed', () => {
        expect(areaIssues(cityDoc())).toEqual([]);
        expect(areaIssues(cityDoc({ minZoom: 14, zoom: 12 }))).toEqual([{ path: 'zoom', code: 'validation.zoomRange' }]);
        expect(areaIssues(cityDoc({ center: { lat: 10, lng: 10 } }))).toEqual([{ path: 'center', code: 'validation.centerOutside' }]);
        expect(areaIssues(cityDoc({ zoom: undefined, center: undefined }))).toEqual([]);
        expect(areaIssues(cityDoc({ bounds: { ...BOUNDS, east: BOUNDS.west } }))).toEqual([]);
    });

    it('badPath_smallerBoundsListThePhotosAndPlacesTheyWouldLeaveOut', () => {
        const small = { west: 26, south: 44.4, east: 26.1, north: 44.5 };
        const photos = [
            { id: 'in', data: photoDoc(44.45, 26.05, 'Înăuntru') },
            { id: 'far', data: photoDoc(46, 26.05, 'Departe') },
        ];
        const pois = [
            { id: 'near', data: poiDoc(44.8, 26.05, 'Aproape') },
            { id: 'away', data: poiDoc(40, 20, 'Altundeva') },
        ];

        expect(contentOutside(small, photos, pois)).toEqual([
            { kind: 'photo', id: 'far', title: 'Departe' },
            { kind: 'poi', id: 'away', title: 'Altundeva' },
        ]);
        expect(boundsGrow(BOUNDS, { ...BOUNDS, west: 25 })).toBe(true);
        expect(boundsGrow(BOUNDS, small)).toBe(false);
    });
});

describe('colours', () => {
    it('happyPath_wcagContrastAndLuminance', () => {
        expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
        expect(luminance('#ffffff')).toBeCloseTo(1, 5);
        expect([isHex('#8B5E3C'), isHex('8b5e3c'), normalizeHex(' #8B5E3C '), normalizeHex('red')]).toEqual([true, false, '#8b5e3c', null]);
    });

    it('happyPath_lightnessMovesKeepTheHue', () => {
        expect(withLightness('#808080', 0.5)).toBe('#ffffff');
        expect(withLightness('#808080', -0.6)).toBe('#000000');
        for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#8b5e3c']) {
            expect(withLightness(hex, 0)).toBe(hex);
        }
    });

    it('badPath_aColourTheGlyphCannotReadOnGetsTheNearestToneThatReads', () => {
        expect(readsWithWhite('#8b5e3c')).toBe(true);
        expect(readsWithWhite('#ffe082')).toBe(false);
        const tone = nearestTone('#ffe082', readsWithWhite);
        expect(tone !== null && readsWithWhite(tone)).toBe(true);
        expect(nearestTone('#8b5e3c', readsWithWhite)).toBe('#8b5e3c');
        expect(nearestTone('#808080', () => false)).toBeNull();
    });
});

describe('the theme', () => {
    const tokens = { light: { '--md-sys-color-primary': '#000000' }, dark: {}, highContrastLight: {}, highContrastDark: {} };

    it('happyPath_aPassingSeedMakesItsOwnTheme', () => {
        const made = seedTheme('#8B5E3C', { theme: () => tokens, passes: () => true });
        expect(made).toEqual({ seed: '#8b5e3c', adjusted: false, theme: { seedColor: '#8b5e3c', tokens: tokensOf(tokens) } });
        expect(SEED_PRESETS).toHaveLength(8);
    });

    it('badPath_aFailingSeedMovesToTheNearestPassingToneAndAnInvalidOneMakesNothing', () => {
        const made = seedTheme('#ffe082', {
            theme: (seed) => ({ ...tokens, light: { seed } }),
            passes: (set) => readsWithWhite(String(set.light['seed'])),
        });
        expect(made?.adjusted).toBe(true);
        expect(made?.seed).not.toBe('#ffe082');
        expect(seedTheme('#zzzzzz', { theme: () => tokens, passes: () => true })).toBeNull();
        expect(seedTheme('#123456', { theme: () => tokens, passes: () => false })?.adjusted).toBe(false);
    });

    it('happyPath_theContrastCheckAsksEachSchemeAtItsMinimum', () => {
        const asked: string[] = [];
        const passes = contrastPasses((set, minimum) => {
            asked.push(`${String(set['--md-sys-color-primary'])} ${String(minimum)}`);
            return set['--md-sys-color-primary'] === 'bad' ? [{}] : [];
        });
        const set = (light: string, highContrastDark: string) => ({
            light: { '--md-sys-color-primary': light },
            dark: { '--md-sys-color-primary': 'dark' },
            highContrastLight: { '--md-sys-color-primary': 'hcl' },
            highContrastDark: { '--md-sys-color-primary': highContrastDark },
        });

        expect(passes(set('light', 'hcd'))).toBe(true);
        expect(asked).toEqual(['light 4.5', 'dark 4.5', 'hcl 7', 'hcd 7']);
        expect(passes(set('bad', 'hcd'))).toBe(false);
        expect(passes(set('light', 'bad'))).toBe(false);
    });

    it('happyPath_theBasemapChoiceKeepsTheStandardConfiguration', () => {
        expect(basemapChoiceOf(undefined)).toBe('standard');
        expect(basemapChoiceOf({ style: 'mapbox://styles/mapbox/standard-satellite' })).toBe('standard-satellite');
        expect(basemapChoiceOf({ style: 'mapbox://styles/someone/custom' })).toBe('custom');
        expect(basemapFor('standard-satellite', { style: 'x', config: { lightPreset: 'dusk' } })).toEqual({
            style: 'mapbox://styles/mapbox/standard-satellite',
            config: { lightPreset: 'dusk' },
        });
        expect(basemapFor('standard', undefined)).toEqual({ style: 'mapbox://styles/mapbox/standard' });
    });
});

describe('the texts', () => {
    it('badPath_theLinesOfLinksThatAreNotHttpsAreNamed', () => {
        const source = 'Despre oraș.\n[bun](https://ok.example)\n[rău](http://bad.example)\r\n\nȘi [altul](javascript:alert)';
        expect(rejectedLinkLines(source)).toEqual([3, 5]);
        expect(rejectedLinkLines('[bun](https://ok.example) <b>text</b>')).toEqual([]);
    });

    it('happyPath_creditsAreAddedEditedMovedAndRemoved', () => {
        const one = withCredit(undefined);
        expect(one).toEqual([{ label: { ro: '', en: '' } }]);
        const edited = editedCredits(one, 0, 'ro', 'Arhiva');
        const linked = editedCredits(edited, 0, 'url', ' https://arhiva.example ');
        expect(linked).toEqual([{ label: { ro: 'Arhiva', en: '' }, url: 'https://arhiva.example' }]);
        expect(editedCredit(linked[0] ?? { label: { ro: '', en: '' } }, 'url', ' ')).toEqual({ label: { ro: 'Arhiva', en: '' } });
        const two = [...linked, { label: { ro: 'B', en: 'B' } }];
        expect(movedCredit(two, 1, -1).map((credit) => credit.label.ro)).toEqual(['B', 'Arhiva']);
        expect(movedCredit(two, 0, -1)).toEqual(two);
        expect(movedCredit(undefined, 0, 1)).toEqual([]);
        expect(withoutCredit(two, 0)).toEqual([{ label: { ro: 'B', en: 'B' } }]);
        expect(withoutCredit(undefined, 0)).toEqual([]);
    });

    it('badPath_theFiftyFirstCreditIsNotAdded', () => {
        const fifty = Array.from({ length: 50 }, () => ({ label: { ro: 'x', en: 'x' } }));
        expect(withCredit(fifty)).toHaveLength(50);
    });

    it('happyPath_aCreditIssueNamesItsRowAndField', () => {
        expect(creditIssue({ path: 'credits[2].label.en', code: 'validation.tooSmall' })).toEqual({ row: 2, field: 'label.en' });
        expect(creditIssue({ path: 'name.ro', code: 'validation.tooSmall' })).toBeNull();
    });

    it('happyPath_englishIsOptionalAndAnEmptyOptionalTextGoesAway', () => {
        expect(withText(undefined, 'ro', 'Oraș')).toEqual({ ro: 'Oraș' });
        expect(withText({ ro: 'Oraș', en: 'City' }, 'ro', 'Orașul')).toEqual({ ro: 'Orașul', en: 'City' });
        expect(withText({ ro: 'Oraș', en: 'City' }, 'en', ' ')).toEqual({ ro: 'Oraș' });
        expect(withText({ ro: 'Oraș' }, 'en', 'City')).toEqual({ ro: 'Oraș', en: 'City' });
        expect(withOptionalText({ ro: 'x' }, 'ro', ' ')).toBeUndefined();
        expect(withOptionalText(undefined, 'en', 'About')).toEqual({ ro: '', en: 'About' });
        expect([textOf({ ro: 'a', en: 'b' }, 'en'), textOf(undefined, 'ro'), textOf({ ro: 'a' }, 'en')]).toEqual(['b', '', '']);
    });
});

describe('the categories', () => {
    const item = (id: string, order: number) =>
        categoryItemOf({ id, path: CATEGORY_PATH(id), data: categoryDoc({ order }), version: `v-${id}`, pending: false });

    it('happyPath_listedInOrderWithTheirIconBundled', () => {
        expect(inOrder([item('b', 2), item('a', 2), item('c', 0)]).map((category) => category.id)).toEqual(['c', 'a', 'b']);
        expect([isBundledIcon('church'), isBundledIcon('rocket'), item('a', 0).bundled]).toEqual([true, false, true]);
    });

    it('happyPath_aNewCategoryGoesLastWithItsDefaults', () => {
        expect(newCategory([{ order: 3 }, { order: 7 }])).toEqual({
            label: { ro: '' },
            icon: 'location_on',
            color: '#8b5e3c',
            defaultOpacity: 1,
            order: 8,
        });
        expect(newCategory([]).order).toBe(0);
    });

    it('badPath_theIdOfANewCategoryNeverClashes', () => {
        expect(newCategoryId('Photos', [])).toBe('photos-2');
        expect(newCategoryId('Clădiri', ['cladiri'])).toBe('cladiri-2');
        expect(newCategoryId('!!!', [])).toBe('category');
    });

    it('badPath_theLimitAndALowContrastColour', () => {
        expect([canAdd(49), canAdd(50)]).toEqual([true, false]);
        expect(categoryIssues({ color: '#ffe082' })).toEqual([{ path: 'color', code: 'validation.value' }]);
        expect(categoryIssues({ color: '#8b5e3c' })).toEqual([]);
        expect(categoryIssues({ color: 'red' })).toEqual([]);
    });

    it('happyPath_reorderingHandsOutTheHeldValues', () => {
        const before = [item('a', 0), item('b', 1), item('c', 2)];
        expect(
            ascendingOrderChanges(
                before,
                [before[2], before[0], before[1]].filter((x) => x !== undefined),
            ),
        ).toEqual([
            { id: 'c', order: 0 },
            { id: 'a', order: 1 },
            { id: 'b', order: 2 },
        ]);
        const tied = [item('a', 1), item('b', 1)];
        expect(
            ascendingOrderChanges(
                tied,
                [tied[1], tied[0]].filter((x) => x !== undefined),
            ),
        ).toEqual([{ id: 'b', order: 0 }]);
    });

    it('happyPath_aDeletionMovesThePlacesInBatchesTheCategoryLast', () => {
        const ids = Array.from({ length: 600 }, (_x, index) => `p${String(index)}`);
        const batches = deletionBatches('bucharest', 'old', ids, 'new');

        expect(batches.map((batch) => batch.length)).toEqual([500, 101]);
        expect(batches[1]?.at(-1)).toEqual({ kind: 'delete', path: CATEGORY_PATH('old') });
        expect(batches[0]?.[0]).toEqual({ kind: 'update', path: 'cities/bucharest/pois/p0', fields: { category: 'new' } });
        expect(deletionBatches('bucharest', 'old', [], null)).toEqual([[{ kind: 'delete', path: CATEGORY_PATH('old') }]]);
    });
});

describe('the settings route', () => {
    it('happyPath_theSectionAndTheCategory', () => {
        expect(settingsRoute([])).toEqual({ section: null, category: null });
        expect(settingsRoute(['theme'])).toEqual({ section: 'theme', category: null });
        expect(settingsRoute(['categories', 'cladiri'])).toEqual({ section: 'categories', category: 'cladiri' });
        expect(settingsRoute(['categories', '_new'])).toEqual({ section: 'categories', category: '_new' });
    });

    it('badPath_anUnknownSectionOrAnInvalidIdOpensNothing', () => {
        expect(settingsRoute(['nope', 'x'])).toEqual({ section: null, category: null });
        expect(settingsRoute(['categories', 'a.b'])).toEqual({ section: 'categories', category: null });
        expect(settingsRoute(['area', 'cladiri'])).toEqual({ section: 'area', category: null });
    });
});
