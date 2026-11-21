/** `<hcm-stories-page>` (M17, `docs/research/M17-stories.md` §6; A100): the list, New story, the editor and its refusals. Axe-clean. */
import type { StoryDoc } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS } from '../../../src/admin/areas/stories.js';
import { withPart, yearOf } from '../../../src/admin/stories/stories-fields.js';
import type { ListStatePort } from '../../../src/admin/area-port.js';
import type { StoriesIntentsPort, StoriesViewState } from '../../../src/admin/stories/stories-port.js';

type Draft = NonNullable<StoriesViewState['open']>['draft'];
import { FakeArea } from '../editing/fake-area.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

const STAMP = { updatedBy: 'u', updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 } };
const STORY: StoryDoc = {
    title: { ro: 'Teatrul', en: 'The theatre' },
    body: { ro: 'A ars.' },
    yearStart: 1852,
    photoIds: ['p1'],
    published: true,
    ...STAMP,
};

function list<Item>(items: readonly Item[], status: 'ready' | 'loading' | 'error' = 'ready'): ListStatePort<Item> {
    const failure = status === 'error' ? { kind: 'failed' as const, code: 'x' } : null;
    return { status, items, hasMore: items.length > 1, reconnecting: false, failure };
}

function draft(value: StoryDoc | null, changes: Partial<Draft> = {}): Draft {
    return {
        base: value === null ? null : { id: 's1', path: 'p', data: value, version: 'v1', pending: false },
        value,
        dirty: [],
        issues: [],
        saving: false,
        conflict: null,
        gone: false,
        ...changes,
    };
}

function state(overrides: Partial<StoriesViewState> = {}): StoriesViewState {
    return {
        list: list([
            { id: 's1', title: STORY.title, yearStart: 1852, yearEnd: null, published: true, review: null },
            { id: 'w1', title: { ro: 'Hanul' }, yearStart: null, yearEnd: null, published: false, review: 'pending' },
            { id: 'd1', title: { ro: 'Ciornă' }, yearStart: null, yearEnd: null, published: false, review: null },
        ]),
        open: { id: 's1', doc: { status: 'ready', doc: null, reconnecting: false, failure: null }, draft: draft(STORY) },
        picks: {
            photos: [
                { id: 'p1', title: { ro: 'Fațada' } },
                { id: 'p2', title: { ro: 'Sala' } },
            ],
            places: [{ id: 'enei', title: { ro: 'Enei' } }],
        },
        reviewer: true,
        role: 'owner',
        busy: false,
        ...overrides,
    };
}

async function page(
    view: StoriesViewState,
    params: readonly string[] = ['s1'],
    answers: Partial<Record<keyof StoriesIntentsPort, unknown>> = {},
) {
    const area = new FakeArea<StoriesViewState, StoriesIntentsPort>(view, answers);
    const app = new FakeAdminApp(adminState({ route: { id: 'stories', params } }));
    app.areas.stories = area;
    AREA_ELEMENTS.define(customElements);
    const host = await mount<HTMLElement>(html`<hcm-stories-page .app=${app} .state=${app.state}></hcm-stories-page>`, 1200);
    await updated(host);
    return { host, area, app };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
    const found = deepAll(host, 'hcm-button').find((item) => item.textContent.includes(label));
    if (found === undefined) {
        throw new Error(`no ${label}`);
    }
    return deep(found, 'button') as HTMLButtonElement;
}

function type(host: HTMLElement, selector: string, value: string): void {
    const input = deep(host, selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
}

describe('<hcm-stories-page> @S-A100-HAPPY-EDIT', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theListAndTheEditorShowAndAreAccessible', async () => {
        const { host } = await page(state());
        const text = deepText(host);
        for (const words of [
            'The theatre',
            '1852',
            'Waiting for review',
            'Unpublished',
            'Fațada',
            'Published on the public map',
            "The story's versions",
        ]) {
            expect(text).toContain(words);
        }
        expect(deep(host, 'a[href="#/history/story/s1"]')).toBeTruthy();
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_editingSendsEachField', async () => {
        const { host, area } = await page(state());
        type(host, '#title-en', 'The National Theatre');
        type(host, '#body-ro', '');
        type(host, '#yearStart', '1900');
        type(host, '#yearEnd', '');
        type(host, '#poiIds', 'enei');
        deep(host, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        deep(deepAll(host, '.chips hcm-button')[0] ?? host, 'button').click();
        expect(area.named('edit')).toEqual([
            'edit {"title":{"ro":"Teatrul","en":"The National Theatre"}}',
            'edit {}',
            'edit {"yearStart":1900}',
            'edit {}',
            'edit {"poiIds":["enei"]}',
            'edit {"published":false}',
            'edit {}',
        ]);
        expect(area.named('loadPicks')).toEqual([]);
    });

    it('happyPath_newStoryOpensIt', async () => {
        const { host, area, app } = await page(state({ open: null }), [], { create: Promise.resolve('new-1') });
        type(host, '#story-new', 'Hanul cu Tei');
        await updated(host);
        button(host, 'New story').click();
        await updated(host);
        expect(area.named('create')).toEqual(['create "Hanul cu Tei"']);
        expect(app.calls.at(-1)).toContain('stories');
        expect(deepText(host)).toContain('Choose a story');
    });

    it('happyPath_deleteAsksFirst', async () => {
        const { host, area } = await page(state(), ['s1'], { remove: Promise.resolve({ ok: true }) });
        button(host, 'Delete the story').click();
        await updated(host);
        deep(host, 'hcm-confirm-dialog').dispatchEvent(new CustomEvent('hcm-cancel'));
        button(host, 'Delete the story').click();
        deep(host, 'hcm-confirm-dialog').dispatchEvent(new CustomEvent('hcm-confirm'));
        await updated(host);
        expect(area.named('remove')).toEqual(['remove']);
    });

    it('happyPath_saveDiscardAndAConflict', async () => {
        const conflict = { by: 'u2', at: '2026-11-08T10:00:00.000Z', fields: ['title'] };
        const { host, area } = await page(
            state({ open: { id: 's1', doc: state().open?.doc as never, draft: draft(STORY, { dirty: ['title'], conflict }) } }),
        );
        expect(deepText(host)).toContain('Someone else changed this story meanwhile');
        button(host, 'Keep my changes').click();
        button(host, 'Take the saved version').click();
        button(host, 'Discard changes').click();
        expect(area.calls.filter((call) => ['keepMine', 'takeTheirs', 'discard'].includes(call))).toEqual([
            'keepMine',
            'takeTheirs',
            'discard',
        ]);
    });

    it('happyPath_thePickersAreAskedForOnce', async () => {
        const { area } = await page(state({ picks: null }));
        expect(area.named('loadPicks').length).toBeGreaterThan(0);
    });
});

describe('<hcm-stories-page>: refusals', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('badPath_anHttpLinkIsSaidAtTheTextAndSaveIsOff', async () => {
        const issues = [{ path: 'body.ro', code: 'validation.markdownLink' as const }];
        const { host } = await page(
            state({ open: { id: 's1', doc: state().open?.doc as never, draft: draft(STORY, { dirty: ['body'], issues }) } }),
        );
        expect(deep(host, '#body-ro').getAttribute('aria-invalid')).toBe('true');
        expect(button(host, 'Save').disabled).toBe(true);
    });

    it('badPath_anUploaderSeesNoPublishedSwitchAndAWaitingNote', async () => {
        const { host } = await page(state({ reviewer: false }));
        expect(deepAll(host, 'hcm-switch')).toHaveLength(0);
        expect(deepText(host)).toContain('A moderator checks it');
    });

    it('badPath_notFoundLoadingAndAFailedList', async () => {
        const gone = { id: 'x', doc: { status: 'ready', doc: null, reconnecting: false, failure: null }, draft: draft(null) } as const;
        const { host } = await page(state({ open: gone, list: list([], 'error') }), ['x']);
        expect(deepText(host)).toContain('No story at this address.');
        expect(deepText(host)).toContain('could not be read');
        cleanup();
        const loading = { ...gone, doc: { ...gone.doc, status: 'loading' } } as const;
        const second = await page(state({ open: loading, list: list([], 'loading') }), ['x']);
        expect(deepText(second.host)).toContain('Loading');
        cleanup();
        const empty = await page(state({ open: null, list: list([]) }), []);
        expect(deepText(empty.host)).toContain('No story yet');
    });

    it('badPath_withPartAndYearOf', () => {
        expect(withPart(undefined, 'ro', '')).toBeUndefined();
        expect(withPart({ ro: 'A', en: 'B' }, 'en', '')).toEqual({ ro: 'A' });
        expect(withPart({ ro: 'A' }, 'ro', '')).toBeUndefined();
        expect(withPart({ ro: 'A', en: 'B' }, 'ro', '')).toEqual({ ro: '', en: 'B' });
        expect(yearOf(' ')).toBeUndefined();
        expect(yearOf('19x')).toBeNaN();
    });
});

describe('<hcm-stories-page>: its edges', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_aBareStoryAndARevokedAdminReadOnly', async () => {
        const bare: StoryDoc = { title: { ro: 'Goală' }, published: false, ...STAMP };
        const area = new FakeArea<StoriesViewState, StoriesIntentsPort>(
            state({
                picks: null,
                reviewer: true,
                list: { ...list([]), failure: null, status: 'error' },
                open: { id: 's1', doc: state().open?.doc as never, draft: draft(bare) },
            }),
        );
        const app = new FakeAdminApp(adminState({ route: { id: 'stories', params: ['s1'] }, revoked: true }));
        app.areas.stories = area;
        AREA_ELEMENTS.define(customElements);
        const host = await mount<HTMLElement>(html`<hcm-stories-page .app=${app} .state=${app.state}></hcm-stories-page>`, 1200);
        await updated(host);
        expect((deep(host, '#title-en') as HTMLInputElement).value).toBe('');
        expect((deep(host, '#yearStart') as HTMLInputElement).value).toBe('');
        expect(deep(host, '#body-ro').hasAttribute('readonly')).toBe(true);
        expect((deep(host, '#photoIds') as HTMLSelectElement).disabled).toBe(true);
        type(host, '#title-ro', '');
        type(host, '#body-en', 'Only English.');
        expect(area.named('edit')).toEqual(['edit {"title":{"ro":""}}', 'edit {"body":{"ro":"","en":"Only English."}}']);
    });

    it('badPath_aLinkTheCityNoLongerHasShowsItsIdAndARefusedStoryWaits', async () => {
        const refused: StoryDoc = { ...STORY, reviewStatus: 'refused', photoIds: ['gone'] };
        const { host } = await page(state({ open: { id: 's1', doc: state().open?.doc as never, draft: draft(refused) } }));
        expect(deepText(host)).toContain('gone');
        expect(deepAll(host, 'hcm-switch')).toHaveLength(0);
    });

    it('badPath_aModeratorGetsNoNewStoryNoDeleteAndNoVersions @S-A100-BAD-ROLE-ACTIONS', async () => {
        const { host } = await page(state({ role: 'moderator' }));
        expect(deepAll(host, '#story-new')).toHaveLength(0);
        expect(deepAll(host, 'hcm-button[icon="delete"]')).toHaveLength(0);
        expect(deepAll(host, 'a[href="#/history/story/s1"]')).toHaveLength(0);
        expect(deepAll(host, 'hcm-switch')).toHaveLength(1);
    });

    it('badPath_anUploaderDeletesOnlyAWaitingStoryAndHasNoVersions', async () => {
        const approved = await page(state({ role: 'uploader', reviewer: false }));
        expect(deepAll(approved.host, 'hcm-button[icon="delete"]')).toHaveLength(0);
        expect(deepAll(approved.host, 'a[href="#/history/story/s1"]')).toHaveLength(0);
        expect(deep(approved.host, '#story-new')).toBeTruthy();
        cleanup();
        const pending: StoryDoc = { ...STORY, published: false, reviewStatus: 'pending' };
        const waiting = await page(
            state({ role: 'uploader', reviewer: false, open: { id: 's1', doc: state().open?.doc as never, draft: draft(pending) } }),
        );
        expect(button(waiting.host, 'Delete the story').disabled).toBe(false);
    });

    it('happyPath_moreAndBackToTheList', async () => {
        const { host, area, app } = await page(state());
        button(host, 'Show more').click();
        deep(host, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));
        deepAll(host, 'button.row')[1]?.click();
        expect(area.named('more')).toEqual(['more']);
        expect(app.calls.filter((call) => call.startsWith('navigate'))).toHaveLength(2);
    });
});
