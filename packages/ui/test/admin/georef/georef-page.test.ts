import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GeorefIntentsPort, GeorefViewState } from '../../../src/admin/georef/georef-port.js';
import { surroundings } from '../../../src/admin/georef/full-screen.js';
import type { FakeArea } from '../editing/fake-area.js';
import { button, click, defineImagery, georefPage, georefReference, georefState, georefVersion, nth } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';

function calls(area: FakeArea<GeorefViewState, GeorefIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

describe('<hcm-georef-page>', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theScanTheMapTheFitTheTransformsAndThePairs', async () => {
        const { element, area } = await georefPage();

        expect(deep(element, '[data-detail-heading]').textContent).toBe('Georeferencer · KH-4A Corona, 12 July 1966');
        expect(deepText(element)).toContain('Fit error: 2.1 m');
        expect(deepText(element)).toContain('Checkpoint error: 6.4 m (checkpoints: 1)');
        expect(deepAll(element, 'hcm-scan-viewer')).toHaveLength(1);
        expect(deepAll(element, 'hcm-admin-map')).toHaveLength(1);
        const radios = deepAll(element, '.transforms input') as HTMLInputElement[];
        expect(radios.map((radio) => [radio.checked, radio.disabled])).toEqual([
            [true, false],
            [false, true],
            [false, true],
        ]);
        expect(deepText(element)).toContain('3 more pairs needed');
        expect(deepAll(element, 'table.residuals tbody tr').map((row) => row.getAttribute('data-pair'))).toEqual(['g1', 'g2', 'g3', 'g4']);
        expect(deepText(element)).toContain('© OpenStreetMap contributors (ODbL)');
        expect(area.named('open')).toEqual(['open ["job-1966"]']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theGuideExplainsThePlacingStepsAndFoldsOnceThereArePairs', async () => {
        const { element } = await georefPage();
        const guide = deep(element, 'details.guide') as HTMLDetailsElement;

        expect(guide.querySelector('summary')?.textContent).toBe('How to place this map');
        expect(guide.querySelectorAll('ol li')).toHaveLength(5);
        expect(guide.open).toBe(false);
    });

    it('happyPath_theToolsTheTableAndTheReferenceCallTheirIntents', async () => {
        const { element, area } = await georefPage(georefState({ dirty: true, canUndo: true }));

        click(button(element, 'Add pairs'));
        click(button(element, 'Add at the centres'));
        click(button(element, 'Save and georeference'));
        click(button(element, 'Discard changes'));
        click(button(element, 'Undo'));
        deepAll(element, 'button.pair')[1]?.click();
        (deepAll(element, '.use input')[0] as HTMLInputElement).click();
        click(nth(element, 'table.residuals hcm-icon-button', 2));
        const shows = deep(element, 'select#map-shows') as HTMLSelectElement;
        shows.value = 'reference:s2';
        shows.dispatchEvent(new Event('change'));
        (deepAll(element, '.transforms input')[0] as HTMLInputElement).dispatchEvent(new Event('change'));
        const toggle = deep(element, 'hcm-switch');
        toggle.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        deep(element, '.slider-row hcm-slider').dispatchEvent(new CustomEvent('hcm-input', { detail: { value: 40 } }));

        const made = calls(area);
        expect(made[0]).toBe('setAdding true');
        expect(made[1]).toMatch(/^addAtCentres \{"x":[\d.]+,"y":[\d.]+\}$/);
        expect(made.slice(2)).toEqual([
            'save',
            'discard',
            'undo',
            'select "g2"',
            'toggle "g1"',
            'remove "g3"',
            'setBase null',
            'setReference "s2"',
            'setTransform "affine"',
            'togglePreview false',
            'setPreviewOpacity 40',
        ]);
    });

    it('happyPath_theResidualsSortLargestFirstAndBack', async () => {
        const { element } = await georefPage();

        deepAll(element, 'button.sort')[1]?.click();
        await updated(element);
        const byResidual = deepAll(element, 'table.residuals tbody tr').map((row) => row.getAttribute('data-pair'));
        const sorted = deepAll(element, 'table.residuals th[aria-sort]').map((header) => header.getAttribute('aria-sort'));
        deepAll(element, 'button.sort')[0]?.click();
        await updated(element);

        expect(byResidual).toEqual(['g4', 'g2', 'g1', 'g3']);
        expect(sorted).toEqual(['none', 'descending']);
        expect(deepAll(element, 'table.residuals tbody tr').map((row) => row.getAttribute('data-pair'))).toEqual(['g1', 'g2', 'g3', 'g4']);
    });

    it('badPath_tooFewADegenerateSetAndARmseOverTheThreshold', async () => {
        const { element, area } = await georefPage(
            georefState({
                fit: {
                    ...georefState().fit,
                    refusal: 'too-few',
                    fitRmseM: null,
                    checkpointRmseM: null,
                    missing: { affine: 2, poly2: 5, tps: 9 },
                },
            }),
        );
        const few = deep(element, '[data-state="too-few"]').textContent;
        area.set({ fit: { ...georefState().fit, refusal: 'degenerate' } });
        await updated(element);
        const degenerate = deep(element, '[data-state="degenerate"]').textContent;
        area.set({ fit: { ...georefState().fit, checkpointRmseM: 31, overThreshold: true } });
        await updated(element);

        expect(few).toContain('Add 2 more pairs for this transform.');
        expect(degenerate).toContain('spread them over the image');
        expect(deep(element, '[data-state="rmse-over"]').textContent).toContain("(31 m) is over the city's threshold (15 m)");
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_editedPairsSayTheFiguresAreARefitThatSavingMakesTheMap', async () => {
        const { element, area } = await georefPage(georefState());
        const unedited = deepAll(element, '[data-state="refitted"]').length;
        area.set({ fit: { ...georefState().fit, refitted: true }, dirty: true });
        await updated(element);

        expect(unedited).toBe(0);
        expect(deep(element, '[data-state="refitted"]').textContent).toContain('a new fit through these pairs');
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-georef-page>: pairs, saving and states', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theHalfPairsHintAndEscDropsIt', async () => {
        const { element, area } = await georefPage(georefState({ adding: true }));
        const hint = deepText(element);
        area.set({ half: { pixel: { x: 10, y: 10 } } });
        await updated(element);
        const onScan = deepText(element);
        area.set({ half: { geo: { lat: 44.4, lng: 26.1 } } });
        await updated(element);
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

        expect(hint).toContain('Click the scan, then the same place on the map');
        expect(onScan).toContain('Now click the same place on the map. Esc cancels.');
        expect(deepText(element)).toContain('Now click the same place on the scan. Esc cancels.');
        expect(calls(area)).toEqual(['cancelHalf']);
    });

    it('happyPath_aSavedVersionOpensOnce', async () => {
        const { element, app, area } = await georefPage();

        area.set({ saved: 'job-1966' });
        await updated(element);
        area.set({ dirty: false });
        await updated(element);

        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","job-1966"]}']);
    });

    it('badPath_aReadOnlyVersionNoScanNoReferenceAndARefusedSave', async () => {
        const version = georefVersion({ editable: false, scan: null, reference: null });
        const { element } = await georefPage(
            georefState({ version, reference: null, refusal: { key: 'apiError.imagery.gcpOutside' }, pairs: [] }),
        );

        expect(deep(element, '[data-state="read-only"]')).toBeDefined();
        expect(deep(element, '[data-state="no-scan"]')).toBeDefined();
        expect(deepText(element)).toContain('No reference image: use the base map.');
        expect(deep(element, '[data-state="no-pairs"]')).toBeDefined();
        expect((button(element, 'Add pairs') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect(deepAll(element, '.page > .alert-slot > .alert[role="alert"]')).toHaveLength(1);
    });

    const panesTop = (element: HTMLElement): number => deep(element, '.panes').getBoundingClientRect().top;

    it('happyPath_aRefusalBannerThatAppearsLeavesThePanesWhereTheyWere @S-A122-HAPPY-GEOREF-BANNER-STILL', async () => {
        const { element, area } = await georefPage(georefState());
        const before = panesTop(element);

        area.set({ refusal: { key: 'apiError.imagery.gcpOutside' } });
        await updated(element);

        expect(deepAll(element, '.alert[role="alert"]')).toHaveLength(1);
        expect(panesTop(element)).toBe(before);
    });

    it('badPath_aRefusalBannerThatGoesLeavesThePanesWhereTheyWere @S-A122-BAD-GEOREF-BANNER-GONE', async () => {
        const { element, area } = await georefPage(georefState({ refusal: { key: 'apiError.imagery.gcpOutside' } }));
        const before = panesTop(element);

        area.set({ refusal: null });
        await updated(element);

        expect(deepAll(element, '.alert[role="alert"]')).toHaveLength(0);
        expect(panesTop(element)).toBe(before);
    });

    it('happyPath_aScanWaitingForPointsCanBeSavedAsItIsAndCompactWindowsSwitchPanes', async () => {
        const { element, area } = await georefPage(
            georefState({ version: georefVersion({ reference: georefReference({ s2Path: null }) }) }),
            {
                width: 400,
                state: { windowClass: 'compact' },
            },
        );

        const save = button(element, 'Save and georeference') as HTMLElement & { disabled: boolean };
        deepAll(deep(element, 'hcm-segmented-button'), 'button')[1]?.click();

        expect(save.disabled).toBe(false);
        expect(deep(element, '.panes').hasAttribute('data-compact')).toBe(true);
        expect(calls(area)).toEqual(['setPane "map"']);
    });

    it('badPath_loadingNotFoundAndAFailedRead', async () => {
        const { element, area } = await georefPage(georefState({ version: null }));
        const loading = deepAll(element, 'hcm-loading-indicator').length;
        area.set({ notFound: true });
        await updated(element);
        const missing = deep(element, '[data-detail-heading]').textContent;
        area.set({ notFound: false, doc: { status: 'error', reconnecting: false, failure: { kind: 'failed', code: 'internal' } } });
        await updated(element);
        click(button(element, 'Try again'));

        expect([loading, missing]).toEqual([1, 'No such version']);
        expect(calls(area)).toEqual(['retry']);
    });
    it('happyPath_theScanAndTheMapPassTheirGesturesOn', async () => {
        const reference = georefReference({ s2Date: null });
        const state = georefState({ scan: { status: 'loading' }, reference: 's2', version: georefVersion({ reference }) });
        const { element, area } = await georefPage(state);
        const viewer = deep(element, 'hcm-scan-viewer') as HTMLElement & { src: string };
        const pixel = { x: 10, y: 20 };

        viewer.dispatchEvent(new CustomEvent('hcm-pick', { detail: { pixel } }));
        viewer.dispatchEvent(new CustomEvent('hcm-select', { detail: { id: 'g1' } }));
        viewer.dispatchEvent(new CustomEvent('hcm-move', { detail: { id: 'g1', pixel } }));
        viewer.dispatchEvent(new CustomEvent('hcm-delete', { detail: { id: 'g1' } }));
        viewer.dispatchEvent(new CustomEvent('hcm-escape'));
        deep(element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: -1 } }));

        expect(viewer.src).toBe('');
        expect(deepText(element)).toContain('Contains modified Copernicus Sentinel data');
        expect(calls(area)).toEqual([
            'pickScan {"x":10,"y":20}',
            'select "g1"',
            'movePixel "g1" {"x":10,"y":20}',
            'remove "g1"',
            'cancelHalf',
            'zoomBy -1',
        ]);
    });

    it('happyPath_theSelectedPairIsPressedAndAPairWithoutAResidualSortsLast', async () => {
        const fit = { ...georefState().fit, residuals: { g1: 1.2, g2: 3.4, g3: 0.8 } };
        const { element } = await georefPage(georefState({ selected: 'g1', fit }));

        deepAll(element, 'button.sort')[1]?.click();
        await updated(element);
        const rows = deepAll(element, 'table.residuals tbody tr');

        expect(rows.map((row) => row.getAttribute('data-pair'))).toEqual(['g2', 'g1', 'g3', 'g4']);
        expect(rows[3]?.textContent).toContain('–');
        expect(deep(nth(element, 'table.residuals tbody tr', 1), 'button.pair').getAttribute('aria-pressed')).toBe('true');
    });
});

describe('<hcm-georef-page>: full screen (M22)', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_fullScreenFillsTheWindowAndEscLeavesIt @S-A122-HAPPY-GEOREF-FULL-SCREEN', async () => {
        const { element } = await georefPage(georefState());

        click(button(element, 'Full screen'));
        await updated(element);
        const filled = deep(element, '.page').hasAttribute('data-full');
        const level = deepAll(element, 'h1').length;
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await updated(element);

        expect(filled).toBe(true);
        expect(level).toBe(1);
        expect(deep(element, '.page').hasAttribute('data-full')).toBe(false);
        expect(document.querySelectorAll('[inert]')).toHaveLength(0);
        expect(deepText(element)).toContain('Full screen');
    });

    it('badPath_leaveFullScreenByItsOwnButton @S-A122-BAD-GEOREF-FULL-SCREEN-LEFT', async () => {
        const { element } = await georefPage(georefState());
        const nav = document.createElement('nav');
        document.body.prepend(nav);
        const around = surroundings(element);

        click(button(element, 'Full screen'));
        await updated(element);
        const inert = around.map((each) => each.hasAttribute('inert'));
        click(button(element, 'Leave full screen'));
        await updated(element);
        nav.remove();

        expect(deep(element, '.page').hasAttribute('data-full')).toBe(false);
        expect(inert.length).toBeGreaterThan(0);
        expect(inert.every(Boolean)).toBe(true);
        expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    });

    it('happyPath_theBrowserFullScreenAndItsEscLeaveThePage @S-A122-HAPPY-GEOREF-REAL-FULL-SCREEN', async () => {
        vi.restoreAllMocks();
        const { element } = await georefPage(georefState());
        const request = vi.spyOn(element, 'requestFullscreen').mockResolvedValue(undefined);

        click(button(element, 'Full screen'));
        await updated(element);
        await Promise.resolve();
        const asked = request.mock.calls.length;
        document.dispatchEvent(new Event('fullscreenchange'));
        await updated(element);

        expect(asked).toBe(1);
        expect(deep(element, '.page').hasAttribute('data-full')).toBe(false);
        expect(deepText(element)).not.toContain('refused full screen');
    });

    it('badPath_refusedFullScreenFillsTheWindowAndSaysSo @S-A122-BAD-GEOREF-FULL-SCREEN-REFUSED', async () => {
        const { element } = await georefPage(georefState());
        vi.spyOn(element, 'requestFullscreen').mockRejectedValue(new TypeError('denied'));

        click(button(element, 'Full screen'));
        await updated(element);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await updated(element);
        document.dispatchEvent(new Event('fullscreenchange'));
        await updated(element);

        expect(deep(element, '.page').hasAttribute('data-full')).toBe(true);
        expect(deepText(element)).toContain('refused full screen');
    });

    it('badPath_leftWhileTheBrowserWasStillEnteringLeavesItsFullScreenToo', async () => {
        vi.restoreAllMocks();
        const { element } = await georefPage(georefState());
        let finish: () => void = () => undefined;
        vi.spyOn(element, 'requestFullscreen').mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
        vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(element);
        const exit = vi.spyOn(document, 'exitFullscreen').mockResolvedValue(undefined);

        click(button(element, 'Full screen'));
        await updated(element);
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        finish();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(exit).toHaveBeenCalled();
        expect(deep(element, '.page').hasAttribute('data-full')).toBe(false);
    });
});
