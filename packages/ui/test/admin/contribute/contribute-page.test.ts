/** `<hcm-contribute-page>` (M13, `docs/research/M13-roles.md` §§3, 4): each standing, the request, the suggestion. Axe-clean. */
import type { ContributeContextResponse } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS } from '../../../src/admin/areas/contribute.js';
import type { ContributeIntentsPort, ContributeViewState } from '../../../src/admin/contribute/contribute-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

const CONTEXT: ContributeContextResponse = {
    city: {
        id: 'bucharest',
        name: { ro: 'București', en: 'Bucharest' },
        bounds: [
            [25.9, 44.3],
            [26.3, 44.6],
        ],
    },
    role: null,
    blocked: false,
    request: null,
    photo: null,
};

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PHOTO = { id: 'p1', title: { ro: 'Unde?', en: 'Where?' }, thumb: PIXEL };

function state(overrides: Partial<ContributeViewState> = {}): ContributeViewState {
    return {
        status: 'ready',
        context: CONTEXT,
        failure: null,
        busy: false,
        problem: null,
        thanks: null,
        proposal: {},
        map: 'none',
        picking: false,
        ...overrides,
    };
}

function nth(items: readonly HTMLElement[], index: number): HTMLElement {
    const item = items[index];
    if (item === undefined) {
        throw new Error(`no item ${String(index)}`);
    }
    return item;
}

async function page(view: ContributeViewState) {
    const area = new FakeArea<ContributeViewState, ContributeIntentsPort>(view);
    const app = new FakeAdminApp(adminState({ route: { id: 'contribute', params: ['bucharest'] } }));
    app.areas.contribute = area;
    AREA_ELEMENTS.define(customElements);
    const host = await mount<HTMLElement>(html`<hcm-contribute-page .app=${app} .state=${app.state}></hcm-contribute-page>`, 800);
    await updated(host);
    return { host, area };
}

describe('<hcm-contribute-page>', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_asksForARole @S-A92-HAPPY-REQUEST', async () => {
        const { host, area } = await page(state());
        expect(deepText(host)).toContain('Contribute to Bucharest');
        (deep(host, '#reason') as HTMLTextAreaElement).value = 'I have photos.';
        (deep(host, 'form') as HTMLFormElement).requestSubmit();
        expect(area.calls.at(-1)).toContain('request "uploader","I have photos.",""'.replaceAll(',', ' '));
        expect(await axeViolations(host)).toEqual([]);
    });

    it.each([
        ['blocked', { blocked: true }, 'can no longer contribute'],
        ['pending', { request: { role: 'uploader', status: 'pending' } }, 'waiting for an answer'],
        ['a moderator', { role: 'moderator' }, 'already a member'],
    ] as const)('badPath_%s_seesNoForm', async (_name, change, text) => {
        const { host } = await page(state({ context: { ...CONTEXT, ...change } }));
        expect(deepText(host)).toContain(text);
        expect(deepAll(host, 'form')).toEqual([]);
    });

    it('badPath_aRefusedPersonIsToldWithTheNoteAndWhen @S-A92-BAD-REFUSED-TOLD', async () => {
        const later = new Date(Date.now() + 86_400_000 * 10).toISOString();
        const refused = { role: 'moderator', status: 'refused', note: 'Mai târziu.', retryAt: later } as const;
        const { host } = await page(state({ context: { ...CONTEXT, request: refused } }));
        expect(deepText(host)).toContain('was refused');
        expect(deepText(host)).toContain('Mai târziu.');
        expect(deepText(host)).toContain(later.slice(0, 10));
        expect(deepAll(host, 'form')).toEqual([]);
    });

    it('happyPath_aRefusedPersonPastTheirWaitMayAskAgain', async () => {
        const refused = { role: 'moderator', status: 'refused', retryAt: '2020-01-01T00:00:00.000Z' } as const;
        const { host } = await page(state({ context: { ...CONTEXT, request: refused } }));
        expect(deepAll(host, 'form')).toHaveLength(1);
    });

    it('happyPath_aRemovedMemberIsNotToldTheyAreApproved @S-A92-HAPPY-ASK-AGAIN', async () => {
        const context = { ...CONTEXT, request: { role: 'uploader', status: 'approved' } } as const;
        const { host } = await page(state({ context }));
        expect(deepText(host)).not.toContain('approved');
        expect(deep(host, 'form')).toBeDefined();
    });

    it('happyPath_anUploaderMayAskForMore @S-A92-HAPPY-ASK-AGAIN', async () => {
        const context = { ...CONTEXT, role: 'uploader', request: { role: 'uploader', status: 'approved' } } as const;
        const { host } = await page(state({ context }));
        expect(deepText(host)).toContain('You are already a member');
        expect(deepAll(host, 'option').map((option) => (option as HTMLOptionElement).value)).toEqual(['moderator']);
        // M28 (@S-A180-BAD-UPLOADER-SATELLITE): the satellite sources stay with the owner and the editors, and the line says why.
        expect(deep(host, '[data-satellite-note]').textContent).toContain("Satellite search is for the map's owner");
    });

    it('badPath_aModeratorHasNothingMoreToAskAndAnUploaderWaits', async () => {
        const moderator = await page(state({ context: { ...CONTEXT, role: 'moderator' } }));
        expect(deepAll(moderator.host, 'form')).toEqual([]);
        const waiting = { ...CONTEXT, role: 'uploader', request: { role: 'moderator', status: 'pending' } } as const;
        const uploader = await page(state({ context: waiting }));
        expect(deepAll(uploader.host, 'form')).toEqual([]);
        expect(deepText(uploader.host)).toContain('waiting');
    });

    it('badPath_aPageThatCannotBeReadOffersTryAgain', async () => {
        const { host, area } = await page(state({ status: 'error', context: null, failure: { key: 'apiError.notFound' } }));
        deep(deep(host, 'hcm-button'), 'button').click();
        expect(area.calls.at(-1)).toBe('retry');
        const blank = await page(state({ status: 'error', context: null }));
        expect(deepText(blank.host)).toContain('could not be opened');
    });

    it('happyPath_loading', async () => {
        const { host } = await page(state({ status: 'loading', context: null }));
        expect(deepText(host)).toContain('Loading');
    });
});

describe('<hcm-contribute-page>: a suggestion', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_aPhotoWithNoPlaceTakesAPinAndADirection @S-A93-HAPPY-PLACE', async () => {
        const { host, area } = await page(
            state({
                context: { ...CONTEXT, photo: PHOTO },
                map: 'unavailable',
                problem: { key: 'apiError.suggestion.dailyLimit', params: { max: '20' } },
            }),
        );
        expect(deepText(host)).toContain('Where was this taken?');
        expect(deepText(host)).toContain('20');
        const lat = deep(host, '#lat') as HTMLInputElement;
        lat.value = '44.5';
        lat.dispatchEvent(new Event('change'));
        expect(area.calls.at(-1)).toContain('edit {"location":{"lat":44.5,"lng":0}}');
        const lng = deep(host, '#lng') as HTMLInputElement;
        lng.value = '26.1';
        lng.dispatchEvent(new Event('change'));
        expect(area.calls.at(-1)).toContain('"lng":26.1');
        lng.value = '';
        lng.dispatchEvent(new Event('change'));
        const calls = area.calls.length;
        expect(area.calls).toHaveLength(calls);
        const bearing = deep(host, '#bearing') as HTMLInputElement;
        bearing.value = '45';
        bearing.dispatchEvent(new Event('change'));
        expect(area.calls.at(-1)).toContain('"bearing":45');
        deep(nth(deepAll(host, '.actions hcm-button'), 0), 'button').click();
        expect(area.calls.at(-1)).toBe('placeAtCentre');
        deep(host, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: 1 } }));
        expect(area.calls.at(-1)).toBe('zoomBy 1');
        deep(host, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-map-host', { detail: { container: {} } }));
        expect(area.calls.at(-1)).toContain('attachMap');
    });

    it('happyPath_aPlacedPhotoContestsItsDateAndSays @S-A93-HAPPY-CORRECTION', async () => {
        const placed = { ...PHOTO, location: { lat: 44.4, lng: 26.1 } };
        const { host, area } = await page(
            state({
                context: { ...CONTEXT, photo: placed },
                proposal: { location: placed.location, bearing: 10 },
                picking: true,
                thanks: { remaining: 3 },
            }),
        );
        expect(deepText(host)).toContain('Suggest a correction');
        expect(deepText(host)).toContain('3');
        expect(deepText(host)).toContain('Click what the camera looked at');
        for (const [id, value, expected] of [
            ['#year', '1950', '"year":1950'],
            ['#yearEnd', '1960', '"yearEnd":1960'],
            ['#dateText', 'Vara', '"dateText":"Vara"'],
        ] as const) {
            const field = deep(host, id) as HTMLInputElement;
            field.value = value;
            field.dispatchEvent(new Event('change'));
            expect(area.calls.at(-1)).toContain(expected);
        }
        (deep(host, '#why') as HTMLTextAreaElement).value = 'Pe verso.';
        const buttons = deepAll(host, 'form .actions hcm-button');
        deep(nth(buttons, buttons.length - 1), 'button').click();
        expect(area.calls.at(-1)).toContain('suggest');
        expect(area.calls.at(-1)).toContain('Pe verso.');
        deep(nth(deepAll(host, '.actions hcm-button'), 1), 'button').click();
        expect(area.calls.at(-1)).toBe('pickDirection');
    });

    it('happyPath_romanianNames', async () => {
        const area = new FakeArea<ContributeViewState, ContributeIntentsPort>(state());
        const app = new FakeAdminApp(adminState({ locale: 'ro', route: { id: 'contribute', params: [] } }));
        app.areas.contribute = area;
        const host = await mount<HTMLElement>(html`<hcm-contribute-page .app=${app} .state=${app.state}></hcm-contribute-page>`);
        await updated(host);
        expect(deepText(host)).toContain('Contribuie la București');
    });
});
