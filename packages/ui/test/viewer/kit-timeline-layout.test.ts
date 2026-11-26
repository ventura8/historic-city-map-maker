/**
 * The timeline's orientation per size class and what sits on it, with the real ui-kit (the owner, 2026-11-08: "for
 * phone or small width setup, maybe it would be wise to show the timeline vertically" and "when height is short, we
 * should display the timeline horizontally"): a short window keeps it horizontal, a compact width stands it up on the
 * leading edge, everything else is horizontal. The selected year's pill never hides another year's label (his phone
 * showed "1980" over 1979 and 1982), and the photos-near-the-year chip stays on the card, uncovered by the open menu.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { defineUiKit } from '../../src/components/define.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import { FakeStore, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { fakeServices, setBox, type Box } from './viewer-harness.js';

/** The owner's city on 2026-11-08: eleven layer years and today, twelve stops. */
const YEARS = [1966, 1967, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] as const;
const MAPBOX_STRIP_PX = 10 + 24 + 8;
const TARGET_GAP_PX = 8;
const GUTTER_PX = 16;

const SIZES: readonly (Box & { readonly orientation: 'horizontal' | 'vertical' })[] = [
    { width: 375, height: 812, orientation: 'vertical' },
    { width: 320, height: 568, orientation: 'vertical' },
    { width: 915, height: 412, orientation: 'horizontal' },
    { width: 768, height: 1024, orientation: 'horizontal' },
    { width: 1440, height: 900, orientation: 'horizontal' },
];

function ownersManifest() {
    return testManifest((raw) => {
        raw['layers'] = YEARS.map((year, order) => ({
            id: `layer-${String(year)}`,
            year,
            label: { ro: `Strat ${String(year)}`, en: `Layer ${String(year)}` },
            kind: 'satellite',
            attribution: 'USGS EROS',
            source: { type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 256 },
            minzoom: 10,
            maxzoom: 17,
            order,
            defaultVisible: false,
            opacity: 1,
        }));
    });
}

/** A viewer of the owner's twelve stops in `box`, settled at its size (window class and compact height). */
async function viewerAt(box: Box, year: number | null = null): Promise<{ element: HcmMapViewer; store: FakeStore }> {
    const store = new FakeStore(readyState(ownersManifest(), { year, consent: 'granted' }));
    const element = document.createElement('hcm-map-viewer');
    element.services = fakeServices();
    setBox(element, box);
    element.attach(store, null);
    document.body.append(element);
    await vi.waitFor(() => {
        expect(store.callsOf('setWindowSize').at(-1)).toEqual([box.width, box.height]);
    });
    await element.updateComplete;
    // On a phone the timeline rests as its pill (V12): these checks are of the whole card, which a press opens.
    element.shadowRoot?.querySelector('hcm-timeline')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    await element.updateComplete;
    return { element, store };
}

function partOf(element: HcmMapViewer, selector: string, inner?: string): Element {
    const host = element.shadowRoot?.querySelector(selector) ?? null;
    const target = inner === undefined ? host : (host?.shadowRoot?.querySelector(inner) ?? null);
    if (target === null) {
        throw new Error(`no ${selector} ${inner ?? ''}`);
    }
    return target;
}

function boxOf(element: HcmMapViewer, selector: string, inner?: string): DOMRect {
    return partOf(element, selector, inner).getBoundingClientRect();
}

function apart(a: DOMRect, b: DOMRect): boolean {
    return a.left >= b.right - 1 || a.right <= b.left + 1 || a.top >= b.bottom - 1 || a.bottom <= b.top + 1;
}

/** The timeline's parts without their springs, so a box is measured where the thumb lands, not on its way. */
async function stillTimeline(element: HcmMapViewer): Promise<ShadowRoot> {
    const timeline = partOf(element, 'hcm-timeline') as HTMLElement & { updateComplete: Promise<boolean> };
    await timeline.updateComplete;
    const root = timeline.shadowRoot;
    if (root === null) {
        throw new Error('no timeline root');
    }
    for (const part of root.querySelectorAll<HTMLElement>('.thumb, .active, .stop')) {
        part.style.transition = 'none';
    }
    return root;
}

async function menuItems(element: HcmMapViewer): Promise<DOMRect[]> {
    await page.getByRole('button', { name: 'Meniu' }).click();
    await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();
    const items = [...(partOf(element, 'hcm-fab-menu').shadowRoot?.querySelectorAll('[role^="menuitem"]') ?? [])];
    expect(items.length).toBeGreaterThan(4);
    return items.map((item) => item.getBoundingClientRect());
}

describe('<hcm-map-viewer> the timeline per size class (the owner, 2026-11-08)', () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        await page.viewport(1500, 1100);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each(SIZES)('happyPath_at $width x $height: theTimelineIs $orientation', async (size) => {
        const { element } = await viewerAt(size);
        const timeline = boxOf(element, 'hcm-timeline');

        await expect.element(page.getByRole('slider', { name: 'Cronologie' })).toHaveAttribute('aria-orientation', size.orientation);
        expect(partOf(element, '.frame').getAttribute('data-timeline')).toBe(size.orientation);
        expect(timeline.height > timeline.width).toBe(size.orientation === 'vertical');
        expect(element.getBoundingClientRect().bottom - timeline.bottom).toBeGreaterThanOrEqual(MAPBOX_STRIP_PX);
    });

    it.each([
        { width: 320, height: 568 },
        { width: 375, height: 812 },
        { width: 915, height: 412 },
        { width: 768, height: 1024 },
    ])('badPath_at $width x $height: theSelectedYearsPillHidesNoOtherYearsLabel', async (size) => {
        const stops = [...YEARS, null];
        const { element, store } = await viewerAt(size, YEARS[0]);
        for (const [selected, year] of stops.entries()) {
            store.set({ year });
            await element.updateComplete;
            const root = await stillTimeline(element);
            const thumb = root.querySelector('.thumb')?.getBoundingClientRect();
            const labels = [...root.querySelectorAll('.stop .label')].map((label) => label.getBoundingClientRect());
            expect(labels).toHaveLength(stops.length);
            const covered = labels.flatMap((label, at) => (at !== selected && thumb !== undefined && !apart(label, thumb) ? [at] : []));
            expect(covered, `labels under the pill at ${String(year)}`).toEqual([]);
        }
    });
});

describe('<hcm-map-viewer> the chip as an icon button under the standing timeline (the owner, 2026-11-12)', () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        await page.viewport(1500, 1100);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        { width: 375, height: 812 },
        { width: 320, height: 568 },
    ])('happyPath_at $width x $height: underTheStandingTimelineTheChipIsAnIconButtonNamedInFull', async (size) => {
        // The owner, 2026-11-12: no wide text pill on a phone; the name and the tooltip keep the full text.
        const { element } = await viewerAt(size, 1977);
        const chip = partOf(element, '.dock.chip [data-layout-check="near-year"]') as HTMLElement & { label: string; icon: string };
        const box = chip.getBoundingClientRect();
        const name = 'Fotografii din jurul anului 1977';

        expect([chip.localName, chip.icon, chip.label, chip.title]).toEqual(['hcm-icon-button', 'photo_library', name, name]);
        expect(chip.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe(name);
        expect(chip.textContent.trim()).toBe('');
        expect([box.width, box.height]).toEqual([40, 40]);
        expect(element.shadowRoot?.querySelector('.dock.chip hcm-button')).toBeNull();
    });

    it('happyPath_theIconButtonOpensThePhotosNearTheYear', async () => {
        const { element, store } = await viewerAt({ width: 375, height: 812 }, 1977);

        (partOf(element, '.dock.chip [data-layout-check="near-year"]') as HTMLElement).click();

        expect(store.callsOf('openSheet').at(-1)).toEqual(['photos']);
    });

    it.each([
        { width: 375, height: 812, year: null },
        { width: 375, height: 812, year: 1700 },
    ])('badPath_onAPhoneAt $year: noPhotosNearTheYearNoButton', async ({ year, ...size }) => {
        const { element } = await viewerAt(size, year);

        expect(element.shadowRoot?.querySelector('.dock.chip')).toBeNull();
        expect(element.shadowRoot?.querySelector('[data-layout-check="near-year"]')).toBeNull();
    });

    it.each([
        { width: 768, height: 1024 },
        { width: 915, height: 412 },
    ])('badPath_at $width x $height: aTabletOrAShortWindowGetsTheIconButtonBesideTheLyingTimeline', async (size) => {
        // The owner, 2026-11-13: the text chip only on large screens.
        const { element } = await viewerAt(size, 1977);
        const chip = partOf(element, '.dock.chip [data-layout-check="near-year"]') as HTMLElement & { label: string };

        expect([chip.localName, chip.label, chip.title]).toEqual([
            'hcm-icon-button',
            'Fotografii din jurul anului 1977',
            'Fotografii din jurul anului 1977',
        ]);
        expect(element.shadowRoot?.querySelector('.dock.chip hcm-button')).toBeNull();
    });

    it('happyPath_aLargeWindowShowsTheTextChipUnderAMouseAndTheIconButtonUnderAFinger', async () => {
        // A tablet on its side is as wide as a laptop: the main pointer decides (`finePointer`, from `(pointer: fine)`).
        const { element } = await viewerAt({ width: 1280, height: 800 }, 1977);

        expect(element.finePointer).toBe(true);
        expect(partOf(element, '.dock.chip [data-layout-check="near-year"]').localName).toBe('hcm-button');
        element.finePointer = false;
        await element.updateComplete;
        expect(partOf(element, '.dock.chip [data-layout-check="near-year"]').localName).toBe('hcm-icon-button');
        expect(element.shadowRoot?.querySelector('.dock.chip hcm-button')).toBeNull();
    });
});

describe('<hcm-map-viewer> the photos-near-the-year chip on the vertical timeline (the owner, 2026-11-08)', () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        await page.viewport(1500, 1100);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        { width: 375, height: 812 },
        { width: 320, height: 568 },
    ])('happyPath_at $width x $height: theChipDocksAtTheCardsFootAndTheFabStaysBottomTrailing', async (size) => {
        const { element } = await viewerAt(size, 1977);
        const frame = element.getBoundingClientRect();
        const timeline = boxOf(element, 'hcm-timeline');
        const chip = boxOf(element, '.dock.chip [data-layout-check="near-year"]');
        const fab = boxOf(element, 'hcm-fab-menu', '.fab');

        expect(timeline.left - frame.left).toBeCloseTo(GUTTER_PX, 0);
        expect(Math.abs(chip.left + chip.width / 2 - (timeline.left + timeline.width / 2)), "on the card's axis").toBeLessThanOrEqual(1);
        expect(Math.abs(chip.top - timeline.bottom - TARGET_GAP_PX), '8 px under the card').toBeLessThanOrEqual(1);
        expect(fab.top - chip.bottom).toBeGreaterThanOrEqual(TARGET_GAP_PX);
        expect(Math.abs(frame.right - fab.right - GUTTER_PX), 'the FAB on the trailing edge').toBeLessThanOrEqual(1);
        expect(Math.abs(frame.bottom - fab.bottom - MAPBOX_STRIP_PX), 'the FAB at the bottom').toBeLessThanOrEqual(1);
    });

    it.each([
        { width: 375, height: 812 },
        { width: 320, height: 568 },
        { width: 915, height: 412 },
        { width: 568, height: 320 },
    ])('badPath_at $width x $height: theOpenMenuCoversNeitherTheChipNorTheTimeline', async (size) => {
        // The owner's 375 px phone: the last item, Despre, covered the end of the chip.
        const { element } = await viewerAt(size, 1977);
        const chip = boxOf(element, '.dock.chip [data-layout-check="near-year"]');
        const timeline = boxOf(element, 'hcm-timeline');
        const frame = element.getBoundingClientRect();

        const items = await menuItems(element);
        const menu = boxOf(element, 'hcm-fab-menu', '[role="menu"]');

        // On a short window the open menu spans the map and the card and the chip step aside (the Pixel 9 Pro review, P1).
        const aside = (selector: string): boolean => getComputedStyle(partOf(element, selector)).visibility === 'hidden';
        expect(apart(menu, chip) || aside('.dock.chip'), 'the menu clear of the chip').toBe(true);
        expect(apart(menu, timeline) || aside('.dock.timeline'), 'the menu clear of the timeline').toBe(true);
        for (const item of items) {
            expect(item.top).toBeGreaterThanOrEqual(frame.top);
            expect(item.left).toBeGreaterThanOrEqual(frame.left);
            expect(item.right).toBeLessThanOrEqual(frame.right);
        }
    });

    it('badPath_at320PxWithWiderTextSpacingTheOpenMenuWrapsBesideTheTimeline', async () => {
        // The tour's text spacing (WCAG 1.4.12) widened the menu to 244 px at 320 px, over the standing timeline.
        const { element } = await viewerAt({ width: 320, height: 568 }, 1977);
        const spacing = document.createElement('style');
        spacing.textContent = '* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }';
        partOf(element, 'hcm-fab-menu').shadowRoot?.append(spacing);
        const timeline = boxOf(element, 'hcm-timeline');

        const items = await menuItems(element);
        const menu = boxOf(element, 'hcm-fab-menu', '[role="menu"]');

        expect(menu.left - timeline.right).toBeGreaterThanOrEqual(TARGET_GAP_PX);
        for (const item of items) {
            expect(item.height).toBeGreaterThanOrEqual(56);
        }
    });

    it('happyPath_onAShortPhoneTheChipSitsOnTheHorizontalCardsTrailingEdgeInBothDirections', async () => {
        const { element } = await viewerAt({ width: 915, height: 412 }, 1977);
        let timeline = boxOf(element, 'hcm-timeline');
        let chip = boxOf(element, '.dock.chip [data-layout-check="near-year"]');
        expect(Math.abs(chip.right - timeline.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(timeline.top - chip.bottom - TARGET_GAP_PX)).toBeLessThanOrEqual(1);

        element.dir = 'rtl';
        await element.updateComplete;
        timeline = boxOf(element, 'hcm-timeline');
        chip = boxOf(element, '.dock.chip [data-layout-check="near-year"]');
        expect(Math.abs(chip.left - timeline.left)).toBeLessThanOrEqual(1);
    });

    it.each(['ltr', 'rtl'] as const)('badPath_onANarrowShortPhone_%s_theChipLeavesTheMapsCentreFree', async (dir) => {
        // The review at 568 x 320: the chip, 8 px above the card's trailing end, sat on the map's centre point.
        const { element } = await viewerAt({ width: 568, height: 320 }, 1977);
        element.dir = dir;
        await element.updateComplete;
        const frame = element.getBoundingClientRect();
        const timeline = boxOf(element, 'hcm-timeline');
        const chip = boxOf(element, '.dock.chip [data-layout-check="near-year"]');
        const centre = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };

        const trailing =
            dir === 'ltr' ? [chip.right, timeline.right, frame.right - chip.right] : [chip.left, timeline.left, chip.left - frame.left];
        expect(Math.abs((trailing[0] ?? 0) - (trailing[1] ?? 0)), "on the card's trailing edge").toBeLessThanOrEqual(1);
        expect(Math.abs((trailing[2] ?? 0) - GUTTER_PX), 'the card and the chip end at the gutter').toBeLessThanOrEqual(1);
        const onCentre = chip.left <= centre.x && centre.x <= chip.right && chip.top <= centre.y && centre.y <= chip.bottom;
        expect(onCentre, 'the chip on the centre').toBe(false);
    });
});

describe('<hcm-map-viewer> the zoom buttons beside the timeline, the chip and the menu button (merge of 2026-11-08)', () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        await page.viewport(1500, 1100);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([...SIZES, { width: 568, height: 320 }].flatMap((size) => (['ltr', 'rtl'] as const).map((dir) => ({ ...size, dir }))))(
        'badPath_at $width x $height $dir: theZoomGroupTouchesNeitherTheTimelineNorTheChipNorTheFab',
        async ({ width, height, dir }) => {
            // Standing, the timeline takes the leading edge and the chip a row above the FAB (as wide as the map on a phone);
            // short, the FAB is on the leading side and the lying card and the chip on the trailing one.
            const { element } = await viewerAt({ width, height }, 1977);
            element.dir = dir;
            await element.updateComplete;
            const frame = element.getBoundingClientRect();
            const zoom = boxOf(element, '.dock.zoom');
            const centre = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };

            for (const [name, other] of [
                ['timeline', boxOf(element, 'hcm-timeline')],
                ['chip', boxOf(element, '.dock.chip [data-layout-check="near-year"]')],
                ['FAB', boxOf(element, 'hcm-fab-menu', '.fab')],
            ] as const) {
                expect(apart(zoom, other), `the zoom group clear of the ${name}`).toBe(true);
            }
            expect(zoom.left >= frame.left && zoom.right <= frame.right && zoom.top >= frame.top).toBe(true);
            expect(frame.bottom - zoom.bottom).toBeGreaterThanOrEqual(MAPBOX_STRIP_PX);
            expect(zoom.left <= centre.x && centre.x <= zoom.right && zoom.top <= centre.y && centre.y <= zoom.bottom).toBe(false);
        },
    );
});
