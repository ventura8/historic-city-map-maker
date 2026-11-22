import { overlaysFromManifest, withOverlayVisibility } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import {
    HCM_LAYER_PANEL_TAG,
    HcmLayerPanel,
    attributionLines,
    defineHcmLayerPanel,
    overlayGroups,
    overlayItems,
    pinnedIds,
    splitPinned,
} from '../../src/viewer/hcm-layer-panel.js';
import { defineKitDoubles, fireKitEvent, mountElement, recordEvents, shadowQuery, shadowText } from './doubles.js';
import { testManifest } from './fixtures.js';

interface OverlayListProps {
    readonly items: readonly { readonly id: string }[];
    readonly groups: readonly { readonly kind: string; readonly label: string }[];
    readonly toggleLabel: string;
    readonly opacityLabel: string;
    readonly valueText: string;
    readonly changedText: string;
}

async function panel(properties: Partial<HcmLayerPanel> = {}): Promise<HcmLayerPanel> {
    const manifest = testManifest();
    return mountElement<HcmLayerPanel>(HCM_LAYER_PANEL_TAG, {
        manifest,
        overlays: overlaysFromManifest(manifest),
        open: true,
        ...properties,
    });
}

/** The Map labels switches as the panel set them. */
function switches(element: HcmLayerPanel): readonly { readonly label: string; readonly checked: boolean }[] {
    const found = element.shadowRoot?.querySelectorAll('hcm-switch') ?? [];
    return [...found].map(({ label, checked }) => ({ label, checked }));
}

describe('overlay list data', () => {
    const manifest = testManifest();
    const overlays = overlaysFromManifest(manifest);

    it('happyPath_everyOverlayWithLocalizedLabelsAndCategorySwatches', () => {
        expect(overlayItems(overlays, manifest, 'en')).toEqual([
            { id: 'kh9-1977', kind: 'raster', label: 'KH-9 1977', visible: false, opacity: 1, detail: '1977' },
            { id: 'kh4-1966', kind: 'raster', label: 'Corona 1966', visible: true, opacity: 0.9, detail: '1966' },
            { id: 'photos', kind: 'photos', label: 'Photos', visible: true, opacity: 1 },
            {
                id: 'cladiri',
                kind: 'poi',
                label: 'Vanished buildings',
                visible: true,
                opacity: 1,
                color: '#8B5E3C',
                icon: 'domain_disabled',
            },
            { id: 'evenimente', kind: 'poi', label: 'Events', visible: true, opacity: 0.8, color: '#386A20', icon: 'location_on' },
        ]);
    });

    it('happyPath_rowsAreNewestFirstWithWhatHasNoDateOnTop', () => {
        // The owner, 2026-11-15: the layers by date, newest first, a day within its year; the other rows keep their places.
        const dated = testManifest((raw) => {
            const layer = (raw['layers'] as Record<string, unknown>[]).find((candidate) => candidate['id'] === 'kh4-1966');
            Object.assign(layer ?? {}, { year: 1977, date: '1977-08-02' });
        });
        const ids = overlayItems(overlaysFromManifest(dated), dated, 'en').map((item) => item.id);

        expect(ids).toEqual(['kh4-1966', 'kh9-1977', 'photos', 'cladiri', 'evenimente']);
    });

    it('happyPath_groupsAndAttributionOfVisibleLayers', () => {
        expect(overlayGroups(manifest, 'ro')).toEqual([
            { kind: 'raster', label: 'Straturi istorice' },
            { kind: 'poi', label: 'Locuri' },
        ]);
        expect(attributionLines(withOverlayVisibility(overlays, 'kh9-1977', true), manifest, 'ro')).toEqual([
            'Sursa: USGS Corona',
            'Sursa: USGS EROS',
        ]);
    });

    it('badPath_theSameCreditOfManyLayersShowsOnceInTheVisitorsLanguage', () => {
        // The Pixel Tablet, 2026-11-12: "Sursa: USGS EROS, declassified imagery (public domain)" once per layer, in English.
        const usgs = 'USGS EROS, declassified imagery (public domain)';
        const both = testManifest((raw) => {
            for (const layer of raw['layers'] as Record<string, unknown>[]) {
                layer['attribution'] = usgs;
            }
        });
        const shown = withOverlayVisibility(overlaysFromManifest(both), 'kh9-1977', true);

        expect(attributionLines(shown, both, 'ro')).toEqual(['Sursa: USGS EROS, imagini desecretizate (domeniu public)']);
        expect(attributionLines(shown, both, 'en')).toEqual([`Source: ${usgs}`]);
    });

    it('badPath_noCategoriesMeansNoPlacesGroup', () => {
        const plain = testManifest((raw) => {
            delete raw['poiCategories'];
            delete raw['pois'];
        });

        expect(overlayGroups(plain, 'en')).toEqual([{ kind: 'raster', label: 'Historical layers' }]);
        expect(overlayItems(overlaysFromManifest(plain), plain, 'en').map((item) => item.id)).toEqual(['kh9-1977', 'kh4-1966', 'photos']);
    });

    it('badPath_aRasterOverlayWithoutItsLayerHasNoAttribution', () => {
        const stray = {
            ...overlays[0],
            id: 'gone',
            kind: 'raster' as const,
            label: { ro: 'x', en: 'x' },
            visible: true,
            opacity: 1,
            defaultVisible: true,
            defaultOpacity: 1,
        };

        expect(attributionLines([stray], manifest, 'ro')).toEqual([]);
    });
});

describe('<hcm-layer-panel>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLayerPanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aNewYearRevealsItsLayersNowOrWhenThePanelOpens', async () => {
        const element = await panel({ year: null });
        const reveals = (): (readonly string[])[] =>
            [...(element.shadowRoot?.querySelectorAll('hcm-overlay-list') ?? [])].flatMap(
                (list) => (list as unknown as { revealed: (readonly string[])[] }).revealed,
            );
        expect(reveals()).toEqual([]);
        element.year = 1977;
        await element.updateComplete;
        await element.updateComplete;
        expect(reveals()).toContainEqual(['kh9-1977']);

        element.open = false;
        await element.updateComplete;
        element.year = 1966;
        await element.updateComplete;
        expect(reveals()).not.toContainEqual(['kh4-1966']);
        element.open = true;
        await element.updateComplete;
        await element.updateComplete;
        expect(reveals()).toContainEqual(['kh4-1966']);
    });

    it('badPath_theFirstYearAndAMinimizedPaneRevealNothing', async () => {
        const element = await panel({ year: 1977, mode: 'docked', minimizable: true, minimized: true });
        element.year = 1966;
        await element.updateComplete;
        await element.updateComplete;
        expect(element.shadowRoot?.querySelector('hcm-overlay-list')).toBeNull();
        element.manifest = null;
        element.minimized = false;
        await element.updateComplete;
        await element.updateComplete;
        expect(element.shadowRoot?.querySelector('hcm-overlay-list')).toBeNull();
    });
});

describe('<hcm-layer-panel> more', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLayerPanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_modalSheetHostsTheOverlayList', async () => {
        const element = await panel({ mode: 'side', locale: 'en' });

        const sheet = shadowQuery(element, 'hcm-sheet') as HTMLElement & {
            open: boolean;
            variant: string;
            label: string;
            closeLabel: string;
        };
        expect(sheet.open).toBe(true);
        expect(sheet.variant).toBe('side');
        expect(sheet.label).toBe('Layers');
        expect(sheet.closeLabel).toBe('Close');
        expect(sheet.hasAttribute('modal')).toBe(false);
        // Places, then the historical layers, each in its own collapsible section (owner, 2026-11-22).
        const lists = [...(element.shadowRoot?.querySelectorAll('hcm-overlay-list') ?? [])] as unknown as (HTMLElement &
            OverlayListProps)[];
        expect(lists.map((each) => each.items.length)).toEqual([2, 2]);
        const list = lists[0] as HTMLElement & OverlayListProps;
        expect(list.groups).toEqual([]);
        expect([list.toggleLabel, list.opacityLabel, list.valueText, list.changedText]).toEqual([
            'Show {name}',
            'Opacity: {name}',
            '{percent}%',
            '{name}: opacity {percent}%',
        ]);
        await expect.element(page.getByText('Source: USGS Corona')).toBeVisible();
    });

    it('happyPath_dockedPanelHasItsOwnHeadingAndClose', async () => {
        const element = await panel({ mode: 'docked' });
        const events = recordEvents(element, 'hcm-close');

        await expect.element(page.getByRole('heading', { name: 'Straturi' })).toBeVisible();
        await page.getByRole('button', { name: 'Închide' }).click();

        expect(events).toHaveLength(1);
    });

    it('badPath_dockedAndClosedRendersNothing', async () => {
        const element = await panel({ mode: 'docked', open: false });

        expect(element.shadowRoot?.querySelector('section')).toBeNull();
    });

    it('badPath_noHistoricalLayersSaysTheyAreComing', async () => {
        const manifest = testManifest((raw) => {
            raw['layers'] = [];
        });
        const element = await panel({ manifest, overlays: overlaysFromManifest(manifest), mode: 'docked' });

        expect(shadowText(element)).toContain('Această hartă nu are straturi istorice.');
        // UX review: the note leads the panel, where the layers will be, not after the photos and places.
        const note = element.shadowRoot?.querySelector('.empty');
        const list = element.shadowRoot?.querySelector('[data-section="layers"] hcm-overlay-list');
        expect(note?.compareDocumentPosition(list ?? note) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('badPath_withoutAManifestTheFrameIsEmpty', async () => {
        const element = await panel({ manifest: null, overlays: [], mode: 'docked' });

        expect(element.shadowRoot?.querySelector('hcm-overlay-list')).toBeNull();
        expect(shadowText(element)).toContain('Straturi');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmLayerPanel();

        expect(customElements.get(HCM_LAYER_PANEL_TAG)).toBe(HcmLayerPanel);
    });

    describe('Map labels (V31)', () => {
        const available = ['streets', 'pois'] as const;
        const shown = { streets: true, pois: false };

        it('happyPath_aSwitchPerLabelTheBasemapHasWithTheirState', async () => {
            const element = await panel({ mode: 'docked', labels: { shown, available } });

            expect(shadowText(element)).toContain('Etichete hartă');
            expect(shadowQuery(element, '[role="group"]').getAttribute('aria-labelledby')).toBe('map-labels');
            expect(switches(element)).toEqual([
                { label: 'Străzi', checked: true },
                { label: 'POI', checked: false },
            ]);
        });

        it('happyPath_aSwitchFiresItsKindAndStopsTheKitsEvent', async () => {
            const element = await panel({ mode: 'docked', labels: { shown, available } });
            const events = recordEvents(element, 'hcm-map-label');
            const inner = recordEvents(element, 'hcm-change');

            fireKitEvent(shadowQuery(element, 'hcm-switch'), 'hcm-change', { checked: false });

            expect(events.map((event) => (event as CustomEvent<unknown>).detail)).toEqual([{ kind: 'streets', visible: false }]);
            expect(inner).toEqual([]);
        });

        it('happyPath_theNoteTellsThemFromTheCitysPlacesOnlyWhenTheCityHasPlaces', async () => {
            const withPlaces = await panel({ mode: 'docked', locale: 'en', labels: { shown, available } });
            expect(shadowText(withPlaces)).toContain("Places below are this site's, with their own switches");

            const city = testManifest();
            const without = { ...city, poiCategories: [], pois: [] };
            const element = await panel({ mode: 'docked', locale: 'en', manifest: without, labels: { shown, available } });
            expect(shadowText(element)).toContain("Today's map labels");
            expect(shadowText(element)).not.toContain('Places above');
        });

        it('happyPath_onlyTheKindTheBasemapHasGetsASwitch', async () => {
            const element = await panel({ mode: 'docked', labels: { shown, available: ['pois'] } });

            expect(switches(element)).toEqual([{ label: 'POI', checked: false }]);
        });

        it('badPath_aBasemapWithoutThePropertiesOrNoMapHasNoGroup', async () => {
            for (const labels of [{ shown, available: [] }, { shown, available: null }, null]) {
                const element = await panel({ mode: 'docked', labels });

                expect(element.shadowRoot?.querySelector('.labels')).toBeNull();
            }
        });
    });
});

describe('<hcm-layer-panel> pinned Compare and map labels', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLayerPanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theCompareButtonOpensAndClosesCompare', async () => {
        const element = await panel({ mode: 'docked', canCompare: true });
        const events = recordEvents(element, 'hcm-compare-toggle');

        await page.getByRole('button', { name: 'Compară' }).click();
        element.comparing = true;
        await element.updateComplete;
        await page.getByRole('button', { name: 'Închide comparația' }).click();

        expect(events).toHaveLength(2);
    });

    it('happyPath_compareAndMapLabelsSitPinnedAboveTheOverlayList', async () => {
        const element = await panel({
            mode: 'docked',
            canCompare: true,
            labels: { shown: { streets: true, pois: true }, available: ['streets', 'pois'] },
        });
        const pinned = element.shadowRoot?.querySelector('.pinned');
        const list = element.shadowRoot?.querySelector('hcm-overlay-list');

        expect(pinned?.querySelector('.compare')).not.toBeNull();
        expect(pinned?.querySelector('.labels')).not.toBeNull();
        expect(pinned?.compareDocumentPosition(list ?? pinned) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('happyPath_theStripStaysPinnedInTheDockedPaneOfALargeWindowOnly', async () => {
        const labels: HcmLayerPanel['labels'] = { shown: { streets: true, pois: true }, available: ['streets', 'pois'] };
        const [width, height] = [window.innerWidth, window.innerHeight];
        await page.viewport(1440, 900);
        const docked = await panel({ mode: 'docked', canCompare: true, labels });
        const dockedStrip = docked.shadowRoot?.querySelector('.pinned');
        expect(dockedStrip === null || dockedStrip === undefined ? '' : getComputedStyle(dockedStrip).position).toBe('sticky');
        document.body.replaceChildren();

        // A modal sheet is too short to keep it: the list scrolled under it hid a focused switch (WCAG 2.4.11).
        const sheet = await panel({ mode: 'bottom', open: true, canCompare: true, labels });
        const sheetStrip = sheet.shadowRoot?.querySelector('.pinned');
        expect(sheetStrip === null || sheetStrip === undefined ? '' : getComputedStyle(sheetStrip).position).toBe('static');
        document.body.replaceChildren();

        // Under 1200 x 700 even the docked pane scrolls it with the list (docs/LESSONS.md 618).
        await page.viewport(1024, 768);
        const small = await panel({ mode: 'docked', canCompare: true, labels });
        const smallStrip = small.shadowRoot?.querySelector('.pinned');
        expect(smallStrip === null || smallStrip === undefined ? '' : getComputedStyle(smallStrip).position).toBe('static');
        await page.viewport(width, height);
    });

    it('badPath_noCompareButtonWithoutHistoricalLayersOrAMap', async () => {
        await panel({ mode: 'docked' });

        await expect.element(page.getByRole('button', { name: 'Compară' })).not.toBeInTheDocument();
    });

    it('badPath_withoutCompareOrMapLabelsThereIsNoPinnedStrip', async () => {
        const element = await panel({ mode: 'docked', canCompare: false, labels: null, manifest: { ...testManifest(), photos: [] } });

        expect(element.shadowRoot?.querySelector('.pinned')).toBeNull();
    });
});

/** M27: the fixture city with a pinned, hidden-at-start Disappeared streets category and its credit. */
function lostStreetsManifest(): ReturnType<typeof testManifest> {
    return testManifest((raw) => {
        (raw['poiCategories'] as unknown[]).push({
            id: 'strazi-disparute',
            label: { ro: 'Străzi dispărute', en: 'Disappeared streets' },
            icon: 'add_road',
            color: '#B3261E',
            defaultOpacity: 0.9,
            defaultVisible: false,
            pinned: true,
            attribution: 'OpenHistoricalMap (CC0)',
        });
    });
}

describe('<hcm-layer-panel> M27 pinned Disappeared streets', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLayerPanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_thePinnedCategoryIsBelowTheExistingPinnedItemsAndAboveEveryLayer @S-V71-HAPPY-PINNED', async () => {
        const manifest = lostStreetsManifest();
        const element = await panel({
            manifest,
            overlays: overlaysFromManifest(manifest),
            mode: 'docked',
            canCompare: true,
            labels: { shown: { streets: true, pois: true }, available: ['streets', 'pois'] },
        });
        const strip = element.shadowRoot?.querySelector('.pinned .section-body');
        const children = [...(strip?.children ?? [])].map((child) => child.className || child.tagName.toLowerCase());
        const lists = [...(element.shadowRoot?.querySelectorAll('hcm-overlay-list') ?? [])] as unknown as OverlayListProps[];

        // Compare, then Map labels and the Photos switch under them, then the pinned category: the existing items keep their place.
        expect(children).toEqual(['compare', 'labels', 'hcm-photos-control', 'pinned-overlays']);
        expect(lists[0]?.items.map((item) => item.id)).toEqual(['strazi-disparute']);
        expect(lists[0]?.groups).toEqual([]);
        // Places and the historical layers below no longer hold it.
        expect(lists[1]?.items.map((item) => item.id)).toEqual(['cladiri', 'evenimente']);
        expect(lists[2]?.items.map((item) => item.id)).toEqual(['kh9-1977', 'kh4-1966']);
        expect(overlaysFromManifest(manifest).find((overlay) => overlay.id === 'strazi-disparute')?.visible).toBe(false);
    });

    it('happyPath_itsCreditShowsOnlyWhileItIsVisible', () => {
        const manifest = lostStreetsManifest();
        const overlays = overlaysFromManifest(manifest);

        expect(attributionLines(overlays, manifest, 'ro')).not.toContain('Sursa: OpenHistoricalMap (CC0)');
        expect(attributionLines(withOverlayVisibility(overlays, 'strazi-disparute', true), manifest, 'ro')).toContain(
            'Sursa: OpenHistoricalMap (CC0)',
        );
    });

    it('badPath_aPinnedCategoryAloneStillMakesTheStripWithoutCompareOrLabels @S-V71-BAD-NOTHING-ELSE-PINNED', async () => {
        const manifest = lostStreetsManifest();
        const element = await panel({
            manifest,
            overlays: overlaysFromManifest(manifest),
            mode: 'docked',
            canCompare: false,
            labels: null,
        });
        const strip = element.shadowRoot?.querySelector('.pinned .section-body');

        expect(strip?.querySelector('.compare')).toBeNull();
        expect(strip?.querySelector('.pinned-overlays')).not.toBeNull();
        await expect.element(page.getByRole('group', { name: 'Straturi fixate sus' })).toBeInTheDocument();
    });

    it('badPath_noPinnedCategoryLeavesTheListWhole', () => {
        const manifest = testManifest();

        expect(splitPinned(overlaysFromManifest(manifest), manifest, true)).toEqual([]);
        expect(pinnedIds(manifest).size).toBe(0);
    });
});

describe('<hcm-layer-panel>: the Photos switch (design B)', () => {
    it('happyPath_thePhotosSwitchSitsInTheTopStripWithTheScope', async () => {
        defineKitDoubles();
        defineHcmLayerPanel();
        const element = await panel({
            photosNear: 25,
            overlays: withOverlayVisibility(overlaysFromManifest(testManifest()), 'photos', false),
        });
        const photos = shadowQuery(element, '.pinned hcm-photos-control') as HTMLElement & {
            visible: boolean;
            near: number | null;
            opacity: number;
        };

        expect(photos.visible).toBe(false);
        expect(photos.near).toBe(25);
        expect(photos.opacity).toBe(1);
        const list = shadowQuery(element, 'hcm-overlay-list') as unknown as OverlayListProps;
        expect(list.items.map((item) => item.id)).not.toContain('photos');
    });

    it('badPath_aCityWithoutPhotosHasNoPhotosSwitch', async () => {
        const element = await panel({ manifest: { ...testManifest(), photos: [] } });

        expect(element.shadowRoot?.querySelector('hcm-photos-control')).toBeNull();
    });
});
