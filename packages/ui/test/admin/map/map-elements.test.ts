import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmAdminMap } from '../../../src/admin/map/hcm-admin-map.js';
import type { HcmDrawToolbar } from '../../../src/admin/map/hcm-draw-toolbar.js';
import { coordinateOf, coordinateText, type HcmVertexList } from '../../../src/admin/map/hcm-vertex-list.js';
import { reportModal } from '../../../src/components/modal-registry.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';

/** Clicks a kit button as a pointer would: its own button (a disabled one fires nothing). */
function press(element: HTMLElement): void {
    deep(element, 'button').click();
}

/** Collects the events of `type` an element fires. */
function events<T>(element: Element, type: string): T[] {
    const seen: T[] = [];
    element.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
    return seen;
}

describe('<hcm-admin-map>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theBoxHandsItsHostOverAndOffersZoomOnceReady', async () => {
        const hosts: unknown[] = [];
        const element = await mount<HcmAdminMap>(
            html`<hcm-admin-map
                css-url=""
                @hcm-map-host=${(event: CustomEvent<{ container: HTMLElement }>) => hosts.push(event.detail.container)}
            ></hcm-admin-map>`,
            600,
        );
        const zooms = events<{ delta: number }>(element, 'hcm-zoom');
        expect(hosts).toEqual([element.container]);
        expect(deepAll(element, 'hcm-icon-button')).toEqual([]);

        element.status = 'ready';
        await updated(element);
        for (const button of deepAll(element, 'hcm-icon-button')) {
            press(button);
        }
        element.status = 'loading';
        await updated(element);

        expect(zooms).toEqual([{ delta: 1 }, { delta: -1 }]);
        expect(deepText(element)).toContain('Loading the map…');
        expect(hosts).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theCrosshairShowsWhileTheMapHasTheFocusAndTheStylesheetIsLinked', async () => {
        const element = await mount<HcmAdminMap>(html`<hcm-admin-map></hcm-admin-map>`, 600);
        const focuses = events<{ focused: boolean }>(element, 'hcm-map-focus');
        const canvas = element.container;
        expect(canvas).not.toBeNull();

        canvas?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        await updated(element);
        expect(element.renderRoot.querySelector('.crosshair')).not.toBeNull();
        canvas?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await updated(element);

        expect(element.renderRoot.querySelector('.crosshair')).toBeNull();
        expect(focuses).toEqual([{ focused: true }, { focused: false }]);
        expect(element.renderRoot.querySelector('link')?.getAttribute('href')).toBe(
            'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css',
        );
    });

    it('happyPath_arrowKeysNudgeOneCssPixelAndTenWithShift', async () => {
        const element = await mount<HcmAdminMap>(html`<hcm-admin-map css-url="" .status=${'ready'}></hcm-admin-map>`, 600);
        const nudges = events<{ dx: number; dy: number }>(element, 'hcm-map-nudge');
        const canvas = element.container;
        expect(canvas).not.toBeNull();
        const key = (name: string, shiftKey = false): void => {
            canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
        };

        key('ArrowLeft');
        key('ArrowRight');
        key('ArrowUp');
        key('ArrowDown', true);
        key('Enter');

        expect(nudges).toEqual([
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: -1 },
            { dx: 0, dy: 10 },
        ]);
    });

    it('badPath_underAModalDialogTheMapHidesWithItsLegalLine', async () => {
        const element = await mount<HcmAdminMap>(html`<hcm-admin-map css-url=""></hcm-admin-map>`, 600);
        element.status = 'ready';
        await updated(element);
        const owner = {};

        reportModal(document, owner, true);
        await updated(element);
        const hidden = [element.container, element.renderRoot.querySelector('.controls')].map(
            (part) => part !== null && getComputedStyle(part).visibility === 'hidden',
        );
        reportModal(document, owner, false);
        await updated(element);

        expect([hidden, element.hasAttribute('covered')]).toEqual([[true, true], false]);
        expect(getComputedStyle(element.container ?? element).visibility).toBe('visible');
        element.remove();
        reportModal(document, owner, true);
        expect(element.covered).toBe(false);
        reportModal(document, owner, false);
    });

    it('badPath_withoutATokenTheBoxSaysWhyAndLeadsToSetup', async () => {
        const element = await mount<HcmAdminMap>(
            html`<hcm-admin-map css-url="" .status=${'no-token'} .locale=${'ro'}></hcm-admin-map>`,
            600,
        );

        expect(deepText(element)).toContain('Harta apare după ce configurezi Mapbox.');
        expect(deep(element, 'a').getAttribute('href')).toBe('#/setup/mapbox');
        expect(element.container?.hidden).toBe(true);
        element.status = 'no-webgl';
        await updated(element);
        expect(deepText(element)).toContain('WebGL 2');
        element.status = 'failed';
        await updated(element);
        expect(deepAll(element, 'a')).toEqual([]);
        element.status = 'unavailable';
        await updated(element);
        expect(deepText(element)).toContain('Harta nu este disponibilă aici încă');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAMapTheBoxIsOnlyAsTallAsItsNote', async () => {
        // The visual audit of 2026-10-18: a page's 45vh map box stayed an empty block above the form without a map.
        const sized = new CSSStyleSheet();
        sized.replaceSync('hcm-admin-map { block-size: 360px; } hcm-admin-map[no-map] { block-size: auto; }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sized];
        const element = await mount<HcmAdminMap>(
            html`<hcm-admin-map css-url="" .status=${'no-token'} .locale=${'ro'}></hcm-admin-map>`,
            600,
        );
        const note = element.renderRoot.querySelector<HTMLElement>('.note');

        expect(element.hasAttribute('no-map')).toBe(true);
        expect(element.getBoundingClientRect().height).toBeCloseTo(note?.getBoundingClientRect().height ?? 0, 0);
        element.status = 'ready';
        await updated(element);
        expect(element.hasAttribute('no-map')).toBe(false);
        expect(element.getBoundingClientRect().height).toBe(360);
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== sized);
    });
});

describe('<hcm-draw-toolbar>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_eachToolIsANamedButtonAndTheActiveOneIsPressed', async () => {
        const element = await mount<HcmDrawToolbar>(
            html`<hcm-draw-toolbar .shape=${'polygon'} .mode=${'draw'} can-delete can-undo></hcm-draw-toolbar>`,
            600,
        );
        const tools = events<{ tool: string }>(element, 'hcm-tool');

        for (const button of deepAll(element, 'hcm-icon-button')) {
            press(button);
        }

        expect(tools.map((detail) => detail.tool)).toEqual(['draw', 'select', 'add-centre', 'delete-vertex', 'undo-vertex']);
        const labels = deepAll(element, 'hcm-icon-button').map((button) => (button as HTMLElement & { label: string; icon: string }).label);
        expect(labels).toEqual(['Draw', 'Select and move', 'Add at centre', 'Delete the chosen position', 'Remove the last position']);
        expect((deep(element, 'hcm-icon-button.draw') as HTMLElement & { icon: string }).icon).toBe('pentagon');
        // A named group, each tool its own Tab stop (no roving tabindex on the tools).
        expect(deep(element, '[role="group"]').getAttribute('aria-label')).toBe('Drawing tools');
        expect(deepAll(element, 'hcm-icon-button').filter((button) => button.hasAttribute('tabindex'))).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAChosenOrRemovablePositionThoseToolsAreOff', async () => {
        const element = await mount<HcmDrawToolbar>(html`<hcm-draw-toolbar .locale=${'ro'}></hcm-draw-toolbar>`, 600);

        const off = deepAll(element, 'hcm-icon-button').map((button) => (button as HTMLElement & { disabled: boolean }).disabled);

        expect(off).toEqual([false, false, false, true, true]);
        expect((deep(element, 'hcm-icon-button.draw') as HTMLElement & { icon: string }).icon).toBe('place');
        expect((deep(element, 'hcm-icon-button.select') as HTMLElement & { selected: boolean }).selected).toBe(true);
    });

    it('badPath_aReadOnlyToolbarOffersNoTool', async () => {
        const element = await mount<HcmDrawToolbar>(html`<hcm-draw-toolbar read-only can-delete can-undo></hcm-draw-toolbar>`, 600);

        expect(deepAll(element, 'hcm-icon-button').map((button) => (button as HTMLElement & { disabled: boolean }).disabled)).toEqual([
            true,
            true,
            true,
            true,
            true,
        ]);
    });

    it('badPath_withoutACentreAddAtCentreIsOff', async () => {
        const element = await mount<HcmDrawToolbar>(html`<hcm-draw-toolbar .canAddCentre=${false}></hcm-draw-toolbar>`, 600);

        expect((deep(element, 'hcm-icon-button.add-centre') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });
});

describe('<hcm-vertex-list>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_positionsAreTypedMovedChosenAndRemoved', async () => {
        const element = await mount<HcmVertexList>(
            html`<hcm-vertex-list
                .positions=${[
                    [26.1, 44.43],
                    [26.11, 44.4300001],
                ]}
                .selected=${1}
            ></hcm-vertex-list>`,
            600,
        );
        const edits = events<unknown>(element, 'hcm-vertex');
        const choices = events<{ index: number | null }>(element, 'hcm-vertex-select');

        const latitude = deep(element, '#v0-lat') as HTMLInputElement;
        latitude.value = '44,44';
        latitude.dispatchEvent(new Event('change'));
        const longitude = deep(element, '#v1-lng') as HTMLInputElement;
        longitude.value = '26.2';
        longitude.dispatchEvent(new Event('change'));
        const [first, second] = deepAll(element, 'button.choose');
        first?.click();
        second?.click();
        for (const button of deepAll(element, 'hcm-icon-button')) {
            press(button);
        }

        expect(edits).toEqual([
            { kind: 'set', index: 0, position: [26.1, 44.44] },
            { kind: 'set', index: 1, position: [26.2, 44.4300001] },
            { kind: 'move', index: 0, by: 1 },
            { kind: 'remove', index: 0 },
            { kind: 'move', index: 1, by: -1 },
            { kind: 'remove', index: 1 },
        ]);
        expect(choices).toEqual([{ index: 0 }, { index: null }]);
        expect(second?.getAttribute('aria-pressed')).toBe('true');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aReadOnlyListShowsThePositionsWithoutChangingThem', async () => {
        const element = await mount<HcmVertexList>(
            html`<hcm-vertex-list
                read-only
                .positions=${[
                    [26.1, 44.43],
                    [26.11, 44.44],
                ]}
            ></hcm-vertex-list>`,
            600,
        );

        expect(deepAll(element, 'input').every((input) => (input as HTMLInputElement).readOnly)).toBe(true);
        expect(deepAll(element, 'hcm-icon-button').every((button) => (button as HTMLElement & { disabled: boolean }).disabled)).toBe(true);
    });

    it('badPath_aCoordinateThatIsNotOneIsPutBack', async () => {
        const element = await mount<HcmVertexList>(html`<hcm-vertex-list .positions=${[[26.1, 44.43]]}></hcm-vertex-list>`, 600);
        const edits = events<unknown>(element, 'hcm-vertex');
        const latitude = deep(element, '#v0-lat') as HTMLInputElement;

        latitude.value = '95';
        latitude.dispatchEvent(new Event('change'));
        element.positions = [];
        await updated(element);
        latitude.value = '44';
        latitude.dispatchEvent(new Event('change'));

        expect(edits).toEqual([]);
        expect(latitude.value).toBe('44');
        expect(deepText(element)).toContain('No position yet');
    });

    it('badPath_aRefusedCoordinateLeavesTheFieldAtTheShapesPosition', async () => {
        const element = await mount<HcmVertexList>(html`<hcm-vertex-list .positions=${[[26.1, 44.43]]}></hcm-vertex-list>`, 600);
        const edits = events<unknown>(element, 'hcm-vertex');
        const longitude = deep(element, '#v0-lng') as HTMLInputElement;

        // The area refuses it (outside the city): its positions do not change, and neither does the field.
        longitude.value = '28.6625';
        longitude.dispatchEvent(new Event('change'));
        await updated(element);
        const refused = longitude.value;
        // Accepted, the area renders the new position.
        longitude.value = '26.2';
        longitude.dispatchEvent(new Event('change'));
        element.positions = [[26.2, 44.43]];
        await updated(element);

        expect(edits).toEqual([
            { kind: 'set', index: 0, position: [28.6625, 44.43] },
            { kind: 'set', index: 0, position: [26.2, 44.43] },
        ]);
        expect([refused, longitude.value]).toEqual(['26.1', '26.2']);
    });

    it('happyPath_coordinatesAreReadAndWrittenWithSevenDecimals', () => {
        expect(coordinateText(26.123456789)).toBe('26.1234568');
        expect(coordinateText(26.1)).toBe('26.1');
        expect(coordinateOf(' 44,5 ', 90)).toBe(44.5);
        expect(coordinateOf('', 90)).toBeNull();
        expect(coordinateOf('x', 90)).toBeNull();
        expect(coordinateOf('-181', 180)).toBeNull();
    });
});

describe('<hcm-admin-map>: removing the chosen point', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_deleteAndBackspaceAskThePageToRemoveItsChosenPointAndOtherKeysAskNothing @S-A16-HAPPY-GEOREF-REMOVE-UNDO', async () => {
        const element = await mount<HcmAdminMap>(html`<hcm-admin-map css-url="" .status=${'ready'}></hcm-admin-map>`, 600);
        const removals = events<Record<string, never>>(element, 'hcm-map-delete');
        for (const key of ['Delete', 'Backspace', 'Enter', 'a']) {
            element.container?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        }

        expect(removals).toHaveLength(2);
    });
});
