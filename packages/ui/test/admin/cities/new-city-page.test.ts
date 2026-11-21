/**
 * `<hcm-new-city-page>` (M5, `docs/research/M5-interfaces.md` §1.6; behaviour A50): the name and Create, the rectangle
 * found by the name or dragged (or clicked corner to corner, or typed edge by edge, kept until all four are there), the
 * map's zoom buttons, an id no city may take, why a rectangle cannot be a city, the done screen with its focus and its
 * live region, and the city menu told at once.
 */
import { axeViolations } from '@hcm/test-support/axe';
import type { SetupViewState } from '../../../src/admin/setup/setup-port.js';
import { FUNNEL_EVENT, type FunnelSignal } from '@hcm/shared/funnels';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS as CITIES } from '../../../src/admin/areas/cities.js';
import type { NewCityIntentsPort, NewCityViewState } from '../../../src/admin/cities/cities-port.js';
import { defineHcmNewCityPage, type HcmNewCityPage } from '../../../src/admin/cities/hcm-new-city-page.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

type CitiesArea = FakeArea<NewCityViewState, NewCityIntentsPort>;

const AREA = { west: 23.5, south: 46.7, east: 23.7, north: 46.8 };

function cityState(overrides: Partial<NewCityViewState> = {}): NewCityViewState {
    return {
        nameRo: '',
        nameEn: '',
        cityId: '',
        idEdited: false,
        bounds: null,
        problem: null,
        located: null,
        seed: '#8a4b2a',
        map: 'ready',
        busy: false,
        error: null,
        created: null,
        ...overrides,
    };
}

async function newCityPage(
    state: NewCityViewState,
    options: {
        readonly locale?: 'ro' | 'en';
        readonly revoked?: boolean;
        readonly width?: number;
        readonly usgs?: boolean;
        readonly creates?: boolean;
    } = {},
): Promise<{ readonly app: FakeAdminApp; readonly area: CitiesArea; readonly element: HcmNewCityPage }> {
    const area: CitiesArea = new FakeArea<NewCityViewState, NewCityIntentsPort>(state, {
        create: Promise.resolve(options.creates ?? true),
    });
    const app = new FakeAdminApp(
        adminState({
            route: { id: 'cities', params: ['new'] },
            locale: options.locale ?? 'en',
            revoked: options.revoked === true,
            setup: { steps: { usgs: { state: options.usgs === true ? 'ok' : 'missing' } } } as unknown as SetupViewState,
        }),
    );
    app.areas.cities = area;
    const element = document.createElement('hcm-new-city-page');
    element.app = app;
    element.state = app.state;
    element.mapCss = '';
    const host = await mount<HTMLElement>(html`<div class="box">${element}</div>`, options.width ?? 1300);
    host.style.blockSize = '900px';
    await updated(element);
    return { app, area, element };
}

function input(element: HcmNewCityPage, selector: string, value: string, type: 'input' | 'change'): void {
    const field = deep(element, selector) as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event(type));
}

/** The element Mapbox draws into, where the page's gesture listens. */
function mapContainer(element: HcmNewCityPage): HTMLElement {
    const container = (deep(element, 'hcm-admin-map') as HTMLElement & { readonly container: HTMLElement | null }).container;
    if (container === null) {
        throw new Error('the map has no element yet');
    }
    return container;
}

/** A pointer gesture on the map, in its own pixels. */
function gesture(element: HcmNewCityPage, from: { x: number; y: number }, to: { x: number; y: number }, moved = true): void {
    const map = mapContainer(element);
    const box = map.getBoundingClientRect();
    const at = (point: { x: number; y: number }) => ({
        clientX: box.left + point.x,
        clientY: box.top + point.y,
        pointerId: 1,
        isPrimary: true,
        bubbles: true,
    });
    map.dispatchEvent(new PointerEvent('pointerdown', at(from)));
    if (moved) {
        map.dispatchEvent(new PointerEvent('pointermove', at(to)));
    }
    map.dispatchEvent(new PointerEvent('pointerup', at(to)));
}

describe('<hcm-new-city-page>', () => {
    beforeAll(() => {
        defineAll();
        CITIES.define(customElements);
        defineHcmNewCityPage();
    });
    afterEach(cleanup);

    it('happyPath_theNameTheDraggedAreaAndCreate @S-A50-HAPPY', async () => {
        const { area, element } = await newCityPage(cityState());

        expect(deepText(element)).toContain('New city');
        expect(deep(element, '.actions hcm-button[icon="add_location_alt"]').hasAttribute('disabled')).toBe(true);
        input(element, '#name-ro', 'Cluj-Napoca', 'input');
        input(element, '#name-en', 'Cluj', 'input');
        input(element, '#city-id', 'cluj', 'change');
        gesture(element, { x: 100, y: 100 }, { x: 300, y: 240 });
        await updated(element);

        expect(area.named('setNameRo')).toEqual(['setNameRo "Cluj-Napoca"']);
        expect(area.named('setNameEn')).toEqual(['setNameEn "Cluj"']);
        expect(area.named('setId')).toEqual(['setId "cluj"']);
        expect(area.named('dragArea')[0]).toMatch(/^dragArea \{"x":100,"y":100\} \{"x":300,"y":240\} \{"width":\d+,"height":\d+\}$/);
        expect(await axeViolations(element)).toEqual([]);

        area.set({ nameRo: 'Cluj-Napoca', cityId: 'cluj', bounds: AREA });
        await updated(element);
        const create = deep(element, 'form hcm-button[variant="filled"]');
        expect(create.hasAttribute('disabled')).toBe(false);
        create.click();
        await updated(element);

        expect(area.named('create')).toEqual(['create']);
        expect((deep(element, '#edge-west') as HTMLInputElement).value).toBe('23.5');
    });

    it('happyPath_twoClicksMakeTheRectangleAndMoveTheMapHandsThePointerBack', async () => {
        const { area, element } = await newCityPage(cityState());

        gesture(element, { x: 50, y: 60 }, { x: 50, y: 60 }, false);
        gesture(element, { x: 200, y: 210 }, { x: 201, y: 210 });
        await updated(element);
        expect(area.named('dragArea')).toHaveLength(1);
        expect(area.named('dragArea')[0]).toContain('{"x":50,"y":60} {"x":201,"y":210}');

        const map = mapContainer(element);
        map.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, isPrimary: true }));
        map.dispatchEvent(new PointerEvent('pointercancel'));
        map.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 20, pointerId: 1 }));
        map.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 20, pointerId: 1 }));
        expect(area.named('dragArea')).toHaveLength(1);
        expect(map.style.cursor).toBe('crosshair');

        deep(element, 'fieldset .actions hcm-button').click();
        await updated(element);
        expect(deepText(element)).toContain('Draw the area');
        expect(map.style.cursor).toBe('');
        gesture(element, { x: 10, y: 10 }, { x: 90, y: 90 });
        expect(area.named('dragArea')).toHaveLength(1);
        deep(element, 'fieldset .actions hcm-button').click();
        await updated(element);
        gesture(element, { x: 10, y: 10 }, { x: 90, y: 90 });
        expect(area.named('dragArea')).toHaveLength(2);
    });

    it('happyPath_theEdgesAreTypedOneByOneTheKeyboardsWay', async () => {
        // docs/LESSONS.md 254: no rectangle (and no alert) until all four edges are there; clearing one keeps the others.
        const { area, element } = await newCityPage(cityState({ map: 'no-token' }));
        const value = (edge: string): string => (deep(element, `#edge-${edge}`) as HTMLInputElement).value;

        input(element, '#edge-west', '23.5', 'change');
        input(element, '#edge-south', '46.7', 'change');
        await updated(element);
        expect(area.named('setArea')).toEqual([]);
        expect(deep(element, '[data-edges-incomplete]').textContent).toContain('all four edges');
        expect(deepAll(element, '[role="alert"]')).toEqual([]);
        input(element, '#edge-east', '23.7', 'change');
        input(element, '#edge-north', '46.8', 'change');
        expect(area.named('setArea')).toEqual([`setArea ${JSON.stringify(AREA)}`]);

        area.set({ bounds: AREA });
        await updated(element);
        input(element, '#edge-north', '', 'change');
        expect(area.named('setArea').at(-1)).toBe('setArea null');
        area.set({ bounds: null });
        await updated(element);
        expect(['west', 'south', 'east', 'north'].map(value)).toEqual(['23.5', '46.7', '23.7', '']);
        input(element, '#edge-west', 'x', 'change');
        await updated(element);
        expect(value('west')).toBe('');
        expect(area.named('setArea')).toHaveLength(2);

        // A rectangle from the map replaces whatever was typed.
        area.set({ bounds: { ...AREA, north: 46.9 } });
        await updated(element);
        expect(['west', 'north'].map(value)).toEqual(['23.5', '46.9']);
        expect(deepAll(element, '[data-edges-incomplete]')).toEqual([]);
    });
});

describe('<hcm-new-city-page>: the city found, the id and the done screen', () => {
    beforeAll(() => {
        defineAll();
        CITIES.define(customElements);
        defineHcmNewCityPage();
    });
    afterEach(cleanup);

    it('happyPath_theCityFoundByItsNameIsSaidOnceAndTheZoomButtonsMoveTheMap @S-A50-HAPPY', async () => {
        const { area, element } = await newCityPage(cityState({ nameRo: 'Cluj', cityId: 'cluj' }));

        area.set({ bounds: AREA, located: 'Cluj-Napoca, Cluj, România' });
        await updated(element);

        expect(deep(element, '[data-area-located]').textContent).toContain('Found on OpenStreetMap: Cluj-Napoca, Cluj, România.');
        expect(deep(element, '[data-live]').textContent).toBe(deep(element, '[data-area-located]').textContent.trim());
        expect(deep(element, 'form hcm-button[variant="filled"]').hasAttribute('disabled')).toBe(false);
        deep(element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: -1 } }));
        expect(area.named('zoomBy')).toEqual(['zoomBy -1']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anIdNoCityMayTakeIsSaidAtItsField @S-A50-BAD-ID-INVALID', async () => {
        const { area, element } = await newCityPage(cityState({ nameRo: 'Cluj', cityId: 'engine', idEdited: true, bounds: AREA }));

        const id = deep(element, '#city-id');
        expect(deep(element, '[data-id-problem]').textContent).toContain('reserved word');
        expect(id.getAttribute('aria-invalid')).toBe('true');
        expect(id.getAttribute('aria-describedby')).toBe('city-id-help city-id-problem');
        expect(deep(element, 'form hcm-button[variant="filled"]').hasAttribute('disabled')).toBe(true);
        expect(await axeViolations(element)).toEqual([]);

        area.set({ cityId: 'cluj' });
        await updated(element);
        expect(deepAll(element, '[data-id-problem]')).toEqual([]);
        expect(id.hasAttribute('aria-invalid')).toBe(false);
    });

    it.each([
        ['validation.tooSmall', 'too small'],
        ['validation.tooBig', 'too large'],
    ] as const)('badPath_aRectangleThatIs %s SaysWhyAndCreateWaits @S-A50-BAD-AREA', async (problem, words) => {
        const { element } = await newCityPage(cityState({ nameRo: 'Cluj', cityId: 'cluj', bounds: AREA, problem }));

        expect(deep(element, '[data-area-problem]').textContent).toContain(words);
        expect(deep(element, 'form hcm-button[variant="filled"]').hasAttribute('disabled')).toBe(true);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aTakenIdIsSaidAtTheFormInRomanian @S-A50-BAD-ID-TAKEN', async () => {
        const { app, area, element } = await newCityPage(
            cityState({
                nameRo: 'Cluj',
                cityId: 'cluj-2',
                idEdited: true,
                bounds: AREA,
                error: { key: 'apiError.city.idTaken', params: { cityId: 'cluj', suggestion: 'cluj-2' } },
            }),
            { locale: 'ro', creates: false },
        );

        expect(deep(element, 'form [role="alert"]').textContent).toContain('cluj');
        deep(element, 'form').dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
        expect(area.named('create')).toEqual(['create']);
        await updated(element);
        expect(app.calls.filter((call) => call.startsWith('refreshCities'))).toEqual([]);
        area.set({ busy: true });
        await updated(element);
        expect(deep(element, 'form hcm-button[variant="filled"]').hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_theDoneScreenTakesTheFocusSaysSoOnceAndTellsTheCityMenu', async () => {
        // docs/LESSONS.md 251 and 255: the form went (the focus would fall to the page) and the city menu waited a minute.
        const { app, area, element } = await newCityPage(cityState({ nameRo: 'Cluj', cityId: 'cluj', bounds: AREA }), { usgs: true });
        deep(element, 'form').dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
        await updated(element);
        expect(app.calls).toContain('refreshCities true');

        area.set({ created: { cityId: 'cluj', name: 'Cluj-Napoca' } });
        await updated(element);

        expect(element.shadowRoot?.activeElement).toBe(deep(element, 'h2[data-detail-heading]'));
        expect(deep(element, '[data-live]').textContent).toBe('Cluj-Napoca was created');
        expect(deep(element, '[data-city-created]').hasAttribute('role')).toBe(false);
        expect(deep(element, '[data-harvest]').getAttribute('data-harvest')).toBe('now');
        area.set({ busy: false });
        await updated(element);
        expect(area.named('create')).toEqual(['create']);
    });

    it('happyPath_theDoneScreenOpensTheNewCitysPagesOrAnotherForm', async () => {
        const { app, area, element } = await newCityPage(cityState({ created: { cityId: 'cluj', name: 'Cluj-Napoca' } }));

        expect(deep(element, '[data-city-created]').textContent).toContain('Cluj-Napoca');
        expect(deep(element, '[data-harvest]').textContent).toContain('once USGS is set up');
        expect(deep(element, '[data-harvest]').textContent).not.toContain('within minutes');
        // M6 (CR-M6-17): no repository step any more; the city's public map is on the admin's own Hosting site.
        const address = deep(element, 'a[data-public-address]');
        expect(address.getAttribute('href')).toBe(new URL('/cluj/', document.baseURI).href);
        expect(address.textContent).toContain(new URL('/cluj/', document.baseURI).href);
        expect(address.getAttribute('target')).toBe('_blank');
        expect(element.shadowRoot?.textContent).not.toContain('site:add');
        expect(await axeViolations(element)).toEqual([]);
        const buttons = deepAll(element, '.actions hcm-button');
        for (const button of buttons) {
            button.click();
        }
        expect(app.calls.filter((call) => call.startsWith('switchCity'))).toEqual([
            'switchCity "cluj" {"id":"photos","params":[]}',
            'switchCity "cluj" {"id":"pois","params":[]}',
            'switchCity "cluj" {"id":"imagery","params":[]}',
        ]);
        expect(area.named('startOver')).toEqual(['startOver']);
    });

    it('happyPath_theAreasChunkNamesThePage', () => {
        expect(CITIES.tag).toBe('hcm-new-city-page');
        expect(customElements.get(CITIES.tag)).toBeDefined();
    });

    it('badPath_aReadOnlyAdminCannotCreateAndLeavingDetachesTheMap', async () => {
        const { area, element } = await newCityPage(cityState({ nameRo: 'Cluj', cityId: 'cluj', bounds: AREA }), { revoked: true });

        expect(deep(element, 'form hcm-button[variant="filled"]').hasAttribute('disabled')).toBe(true);
        element.remove();
        expect(area.named('detachMap')).toEqual(['detachMap']);

        const empty = document.createElement('hcm-new-city-page');
        await mount<HTMLElement>(html`<div>${empty}</div>`);
        expect(empty.shadowRoot?.textContent.trim()).toBe('');
    });
});

describe('<hcm-new-city-page> funnel', () => {
    afterEach(cleanup);

    it('happyPath_thePageReportsItsFunnelAsItsStoreChanges', async () => {
        // @S-A150-HAPPY-FUNNEL-ORDER: New city's steps, in order, as codes.
        const seen: FunnelSignal[] = [];
        const listen = (event: Event): void => {
            seen.push((event as CustomEvent<FunnelSignal>).detail);
        };
        document.addEventListener(FUNNEL_EVENT, listen);
        const { area, element } = await newCityPage(cityState());
        area.set({ nameRo: 'Cluj', cityId: 'cluj' });
        await updated(element);
        area.set({ bounds: AREA, problem: 'validation.tooBig' });
        await updated(element);
        document.removeEventListener(FUNNEL_EVENT, listen);
        expect(seen).toEqual([
            { kind: 'view', wizard: 'new_city', step: 'names', back: false },
            { kind: 'complete', wizard: 'new_city', step: 'names' },
            { kind: 'view', wizard: 'new_city', step: 'area', back: false },
            { kind: 'error', wizard: 'new_city', step: 'area', code: 'validation.tooBig' },
        ]);
    });
});
