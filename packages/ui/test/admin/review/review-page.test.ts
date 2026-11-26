/** `<hcm-review-page>` (M13, `docs/research/M13-roles.md` §8): the queues, each decision, what strangers typed shown as text. Axe-clean. */
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS } from '../../../src/admin/areas/review.js';
import type {
    ReviewIntentsPort,
    ReviewItemPort,
    ReviewRequestPort,
    ReviewSuggestionPort,
    ReviewViewState,
} from '../../../src/admin/review/review-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function list<Item>(items: readonly Item[]) {
    return { status: 'ready', items, hasMore: false, reconnecting: false, failure: null } as const;
}

const ITEM: ReviewItemPort = {
    entity: 'photo',
    id: 'p1',
    title: { ro: 'Poză', en: 'Picture' },
    thumbPath: 'held/t.webp',
    credit: 'Maria',
    description: { ro: 'Text', en: 'What it says' },
    links: [{ url: 'https://example.org/l', label: 'Where it came from' }],
    seenAt: '2026-10-12T08:00:00.000Z',
};
const POI: ReviewItemPort = {
    entity: 'poi',
    id: 'l1',
    title: { ro: 'Loc' },
    thumbPath: null,
    credit: null,
    description: null,
    links: [],
    seenAt: '2026-10-12T08:00:00.000Z',
};
const SUGGESTION: ReviewSuggestionPort = {
    id: 's1',
    photoId: 'p1',
    title: { ro: 'Unde?', en: 'Where?' },
    thumb: PIXEL,
    kind: 'place',
    status: 'pending',
    proposal: { location: { lat: 44.44, lng: 26.1 }, bearing: 45, year: 1936, yearEnd: 1940, dateText: 'Vara' },
    count: 2,
    voices: [
        { uid: 'a', reason: '<b>Se vede</b> biserica.', sourceUrl: 'https://example.org/s', credit: 'Maria' },
        { uid: 'b', reason: null, sourceUrl: null, credit: null },
    ],
    decidedBy: null,
};
const REQUEST: ReviewRequestPort = {
    uid: 'u1',
    role: 'moderator',
    reason: 'Vreau să ajut.',
    credit: 'Ana',
    name: 'Ana',
    email: 'ana@e.test',
};

function state(overrides: Partial<ReviewViewState> = {}): ReviewViewState {
    return {
        photos: list([ITEM]),
        places: list([POI]),
        stories: list([{ ...POI, entity: 'story', id: 'st1', title: { ro: 'Teatrul' } }]),
        suggestions: list([SUGGESTION]),
        decided: list([{ ...SUGGESTION, id: 's2', status: 'approved', decidedBy: 'u', proposal: { year: 1950 } }]),
        requests: list([REQUEST]),
        blocked: list([]),
        confirmBlock: null,
        pictures: { 'held/t.webp': PIXEL },
        selected: null,
        current: null,
        adjusted: null,
        map: 'none',
        busy: false,
        ...overrides,
    };
}

async function page(view: ReviewViewState) {
    const area = new FakeArea<ReviewViewState, ReviewIntentsPort>(view);
    const app = new FakeAdminApp(adminState({ route: { id: 'review', params: [] } }));
    app.areas.review = area;
    AREA_ELEMENTS.define(customElements);
    const host = await mount<HTMLElement>(html`<hcm-review-page .app=${app} .state=${app.state}></hcm-review-page>`, 900);
    await updated(host);
    return { host, area };
}

/** The button named `label` inside the card that says `text`. */
function press(host: HTMLElement, text: string, label: string): void {
    const card = deepAll(host, 'li.card').find((item) => item.textContent.includes(text));
    const button = card === undefined ? undefined : deepAll(card, 'hcm-button').find((item) => item.textContent.includes(label));
    if (button === undefined) {
        throw new Error(`no ${label} beside ${text}`);
    }
    deep(button, 'button').click();
}

describe('<hcm-review-page>', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_everyQueueShows @S-A90-HAPPY-APPROVE', async () => {
        const { host } = await page(state());
        const text = deepText(host);
        for (const expected of [
            'Contributions',
            'Picture',
            'Loc',
            'Suggestions',
            '2 people suggested this',
            'Requests for a role',
            'Ana (ana@e.test)',
        ]) {
            expect(text).toContain(expected);
        }
        expect(await axeViolations(host)).toEqual([]);
        // M17: an uploader's story waits beside the photos and places, and opens in its own editor.
        expect(text).toContain('Teatrul');
        expect(deepAll(host, 'li.card a').map((a) => a.getAttribute('href'))).toContain('#/stories/st1');
    });

    it('happyPath_whatAStrangerTypedIsText @S-A93-BAD-MARKUP-IS-TEXT', async () => {
        const { host } = await page(state());
        expect(deepText(host)).toContain('<b>Se vede</b> biserica.');
        expect(deepAll(host, 'b')).toEqual([]);
        expect(deepAll(host, 'a[rel="noopener noreferrer nofollow ugc"]')).toHaveLength(2);
    });

    it('happyPath_decidingAnItem', async () => {
        const { host, area } = await page(state());
        (deep(host, '#note-photo-p1') as HTMLInputElement).value = 'Bună.';
        press(host, 'Picture', 'Approve');
        expect(area.calls.at(-1)).toContain('decideItem');
        expect(area.calls.at(-1)).toContain('"approve" "Bună."'.replace(' ', ' '));
        press(host, 'Loc', 'Refuse');
        expect(area.calls.at(-1)).toContain('"refuse"');
    });

    it('happyPath_aSuggestionIsComparedThenDecided @S-A93-HAPPY-ADJUST', async () => {
        const { host, area } = await page(state());
        press(host, 'suggested this', 'Compare');
        expect(area.calls.at(-1)).toBe('select "s1"');
        area.set({ selected: 's1', current: { location: { lat: 44.5, lng: 26.2 } }, map: 'ready' });
        await updated(host);
        expect(deepText(host)).toContain('Now: 44.5, 26.2');
        expect(deepText(host)).toContain('Proposed: 44.44, 26.1 · 45° · 1936–1940 · Vara');
        press(host, 'suggested this', 'Adjust');
        expect(area.calls.at(-1)).toBe('startAdjusting');
        area.set({ adjusted: { location: { lat: 44.45, lng: 26.15 }, year: 1950 } });
        await updated(host);
        expect(deepText(host)).toContain('Proposed: 44.45, 26.15 · 1950');
        expect(deepText(host)).toContain('Move the pin');
        press(host, 'suggested this', 'Approve my values');
        expect(area.calls.at(-1)).toContain('"adjust"');
        press(host, 'suggested this', 'Reject');
        expect(area.calls.at(-1)).toContain('"reject"');
        press(host, 'suggested this', 'Approve');
        deep(host, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: -1 } }));
        expect(area.calls.at(-1)).toBe('zoomBy -1');
        deep(host, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-map-host', { detail: { container: {} } }));
        expect(area.calls.at(-1)).toContain('attachMap');
    });

    it('happyPath_aPhotoWithNoPlaceSaysSo', async () => {
        const { host } = await page(state({ selected: 's1', current: {}, map: 'unavailable' }));
        expect(deepText(host)).toContain('Now: no place yet');
        const none = await page(state({ selected: 's1', current: null, map: 'unavailable' }));
        expect(deepText(none.host)).toContain('Now: no place yet');
    });
});

describe('<hcm-review-page>: more', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theCardShowsWhatAnApprovalPublishes', async () => {
        const { host } = await page(state());
        const text = deepText(host);
        expect(text).toContain('What it says');
        expect(deepAll(host, 'li.card a').map((a) => a.getAttribute('href'))).toContain('https://example.org/l');
    });

    it('happyPath_adjustingOffersEveryValue @S-A93-HAPPY-ADJUST-FIELDS', async () => {
        const { host, area } = await page(state({ selected: 's1', adjusted: { year: 1950 }, current: {} }));
        const type = (id: string, value: string): void => {
            const input = deep(host, `#${id}`) as HTMLInputElement;
            input.value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        expect((deep(host, '#year') as HTMLInputElement).value).toBe('1950');
        type('lat', '44.45');
        type('lng', '26.15');
        type('bearing', '80');
        type('yearEnd', '1960');
        type('dateText', 'Vara');
        const edits = area.named('editAdjusted').join('\n');
        for (const edit of ['"bearing":80', '"yearEnd":1960', '"dateText":"Vara"', '"location":{"lat":44.45,"lng":0}']) {
            expect(edits).toContain(edit);
        }
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_blockAsksFirstAndABlockedAccountSaysSo @S-A93-HAPPY-UNBLOCK', async () => {
        const blocked = list([{ uid: 'a', about: 'Reclame.' }]);
        const { host, area } = await page(state({ blocked, confirmBlock: { uid: 'b', about: null } }));
        const dialog = deep(host, 'hcm-confirm-dialog');
        expect(dialog.hasAttribute('open')).toBe(true);
        dialog.dispatchEvent(new CustomEvent('hcm-confirm'));
        dialog.dispatchEvent(new CustomEvent('hcm-cancel'));
        expect(area.named('confirmBlock')).toHaveLength(1);
        expect(area.named('cancelBlock')).toHaveLength(1);
        press(host, '<b>Se vede</b> biserica.', 'Let this account back');
        expect(area.named('unblock').at(-1)).toContain('"a"');
        expect(deepText(host)).toContain('Reclame.');
        press(host, 'Reclame.', 'Let this account back');
        expect(area.named('unblock')).toHaveLength(2);
        press(host, 'suggested this', 'Block this account');
        expect(area.calls.at(-1)).toContain('askBlock "b"');
    });

    it('happyPath_blockAndRevertAndARequest @S-A93-BAD-BLOCKED', async () => {
        const { host, area } = await page(state());
        press(host, 'suggested this', 'Block');
        expect(area.calls.at(-1)).toContain('askBlock "a"');
        press(host, '1950', 'Revert');
        expect(area.calls.at(-1)).toContain('revert');
        press(host, 'Ana (ana@e.test)', 'Approve');
        expect(area.calls.at(-1)).toContain('decideRequest "u1" "approve"');
        press(host, 'Ana (ana@e.test)', 'Refuse');
        expect(area.calls.at(-1)).toContain('"refuse"');
    });

    it('badPath_aModeratorHasNoRequestsAndNothingWaits @S-A91-BAD-NO-REQUESTS', async () => {
        const { host } = await page(
            state({ photos: list([]), places: list([]), suggestions: list([]), decided: list([]), requests: null }),
        );
        expect(deepText(host)).not.toContain('Requests for a role');
        expect(deepText(host)).toContain('Nothing is waiting.');
    });
});
