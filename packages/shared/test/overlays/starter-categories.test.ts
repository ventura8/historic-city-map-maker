import { describe, expect, it } from 'vitest';

import { missingStarterCategories, STARTER_POI_CATEGORIES, starterCategoryDocs } from '../../src/overlays/starter-categories.js';
import { POI_ICONS, poiCategorySchema } from '../../src/schemas/poi.js';

/** The WCAG contrast of `hex` against white. */
function contrastWithWhite(hex: string): number {
    const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
    const [r = 0, g = 0, b = 0] = channels.map((value) => (value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

describe('STARTER_POI_CATEGORIES', () => {
    it('happyPath_everyStarterCategoryHasBothLabelsABundledIconAndAColourTheWhiteGlyphReadsOn', () => {
        expect(STARTER_POI_CATEGORIES.map((category) => category.label.en)).toEqual(['Building', 'Street', 'Square', 'Church', 'Monument']);
        for (const category of STARTER_POI_CATEGORIES) {
            expect(POI_ICONS).toContain(category.icon);
            expect(category.label.ro).not.toBe('');
            expect(contrastWithWhite(category.color)).toBeGreaterThanOrEqual(3);
        }
    });
});

describe('starterCategoryDocs', () => {
    it('happyPath_aNewCityGetsTheSlugsOfTheRomanianLabelsInOrderFromZero', () => {
        const docs = starterCategoryDocs([]);
        expect(docs.map((doc) => doc.id)).toEqual(['cladire', 'strada', 'piata', 'biserica', 'monument']);
        expect(docs.map((doc) => doc.order)).toEqual([0, 1, 2, 3, 4]);
        for (const { id, label, icon, color, defaultOpacity } of docs) {
            expect(poiCategorySchema.safeParse({ id, label, icon, color, defaultOpacity }).success).toBe(true);
        }
    });

    it('badPath_takenIdsAreAvoidedAndOrdersFollowTheCitysOwn', () => {
        const docs = starterCategoryDocs(['cladire', 'strada-2', 'strada'], 7);
        expect(docs.map((doc) => doc.id)).toEqual(['cladire-2', 'strada-3', 'piata', 'biserica', 'monument']);
        expect(docs[0]?.order).toBe(7);
        expect(docs.at(-1)?.order).toBe(11);
    });
});

describe('missingStarterCategories', () => {
    const missing = (labels: readonly { ro: string; en?: string }[]): string[] =>
        missingStarterCategories(labels.map((label) => ({ label }))).map((category) => category.label.en);

    it('happyPath_aStarterIsThereWhenARomanianOrEnglishLabelNamesItCaseDiacriticsAndSpacingAside', () => {
        expect(missing([])).toEqual(['Building', 'Street', 'Square', 'Church', 'Monument']);
        expect(missing([{ ro: 'BISERICA' }, { ro: 'Străzi', en: '  street  ' }, { ro: 'Porturi', en: 'Ports' }])).toEqual([
            'Building',
            'Square',
            'Monument',
        ]);
        expect(missing([{ ro: 'piata' }, { ro: 'Edificiu', en: 'BUILDING' }, { ro: 'Monument   istoric' }])).toEqual([
            'Street',
            'Church',
            'Monument',
        ]);
    });

    it('badPath_onlyAnExactNameCountsSoClădiriIsNotClădire', () => {
        expect(missing([{ ro: 'Clădiri', en: 'Buildings' }, { ro: 'Biserici' }])).toEqual([
            'Building',
            'Street',
            'Square',
            'Church',
            'Monument',
        ]);
    });

    it('happyPath_onlyTheGivenStartersGetIdsAndOrders', () => {
        const [, street, , , monument] = STARTER_POI_CATEGORIES;
        const docs = starterCategoryDocs(
            ['strada'],
            3,
            [street, monument].filter((category) => category !== undefined),
        );
        expect(docs.map((doc) => [doc.id, doc.order])).toEqual([
            ['strada-2', 3],
            ['monument', 4],
        ]);
    });
});
