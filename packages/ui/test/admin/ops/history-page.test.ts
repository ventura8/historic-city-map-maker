import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { describeValue } from '../../../src/admin/history/describe.js';
import type { HistoryDocumentPort, HistoryIntentsPort, HistoryViewState } from '../../../src/admin/history/history-port.js';
import { currentName, nameText } from '../../../src/admin/history/history-text.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { historyItem, historyState, LOADING, page, ready } from './fixtures.js';

const OLDER = historyItem({
    entryId: '1760690000000-title',
    changedFields: ['title'],
    by: 'owner-uid',
    previous: { title: { ro: 'Gara veche' } },
    name: { ro: 'Gara veche' },
});
const CREATED = historyItem({ entryId: '1760600000000-create', action: 'create', changedFields: [], previous: null, name: null });

function documentView(overrides: Partial<HistoryDocumentPort> = {}): HistoryDocumentPort {
    return {
        key: 'poi/gara',
        document: { entity: 'poi', cityId: 'bucharest', entityId: 'gara' },
        current: {
            status: 'ready',
            reconnecting: false,
            failure: null,
            doc: { id: 'gara', path: 'cities/bucharest/pois/gara', version: '', pending: false, data: { published: false } },
        },
        entries: ready([historyItem(), OLDER, CREATED]),
        ...overrides,
    };
}

function area(state: HistoryViewState): FakeArea<HistoryViewState, HistoryIntentsPort> {
    return new FakeArea<HistoryViewState, HistoryIntentsPort>(state, { revert: Promise.resolve(true) });
}

describe('<hcm-history-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theCitysRecentChangesWithWhoAndWhenAndTheFilters', async () => {
        const history = area(historyState());
        const { element } = await page('history', history);

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/history/poi/gara', '#/history/photo/foto']);
        expect(rows[0]?.textContent).toContain('North Station');
        expect(rows[0]?.textContent).toContain('Changed by Ion on Oct 17, 2026');
        expect(rows[1]?.textContent).toContain('Photo foto');
        expect(rows[1]?.textContent).toContain('Deleted by the server');
        const entity = deep(element, '#entity') as HTMLSelectElement;
        entity.value = 'poi';
        entity.dispatchEvent(new Event('change'));
        const action = deep(element, '#action') as HTMLSelectElement;
        action.value = 'delete';
        action.dispatchEvent(new Event('change'));
        rows[0]?.click();

        expect(history.calls.filter((call) => !call.startsWith('open'))).toEqual([
            'setFilter {"entity":"poi"}',
            'setFilter {"action":"delete"}',
            'select "1760700000000-pub"',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_restoringADeletedDocumentAsksFirst', async () => {
        const history = area(historyState());
        const { element } = await page('history', history);

        deep(element, '.with-action hcm-button').click();
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean; headline: string };
        expect([dialog.open, dialog.headline]).toEqual([true, 'Restore what was deleted?']);
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(history.named('revert')).toHaveLength(1);
        expect(history.named('revert')[0]).toContain('"entryId":"1760710000000-del"');
    });

    it('happyPath_aDocumentsVersionsAndTheShownEntrysFieldsBeforeAndAfter', async () => {
        const changes = [{ field: 'published', before: true, after: false }];
        const history = area(historyState({ document: documentView(), changes }));
        const { element } = await page('history', history, { params: ['poi', 'gara'] });

        expect(deep(element, '.list-head h2').textContent).toBe('Versions of North Station');
        expect(deepAll(element, '.tag')).toHaveLength(0);
        const versions = deepAll(element, 'button.row');
        expect(versions.map((version) => version.getAttribute('aria-current'))).toEqual(['true', 'false', 'false']);
        expect(deepText(deep(element, '.changes'))).toBe('Published Before: yes After: no');
        versions[1]?.click();
        deep(element, '.pane .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();

        expect(history.named('select')).toEqual(['select "1760690000000-title"']);
        expect(history.named('revert')[0]).toContain('"entryId":"1760700000000-pub"');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aReadOnlyPageRevertsNothing', async () => {
        const changes = [{ field: 'published', before: true, after: false }];
        const history = area(historyState({ document: documentView(), changes }));
        const { element } = await page('history', history, { params: ['poi', 'gara'], revoked: true });

        expect((deep(element, '.pane .actions hcm-button') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('badPath_aReadOnlyPageRestoresNothing', async () => {
        const { element } = await page('history', area(historyState()), { revoked: true });

        expect((deep(element, '.with-action hcm-button') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('badPath_aCreationOffersNoRevertAndARefusalShowsAsAnAlert', async () => {
        const history = area(
            historyState({
                document: documentView(),
                selected: '1760600000000-create',
                changes: [],
                refusal: { key: 'apiError.history.nothingToRestore' },
            }),
        );
        const { element } = await page('history', history, { params: ['poi', 'gara'], width: 700 });

        expect(deepText(element)).toContain('The creation has no earlier version to bring back.');
        expect(deepAll(element, '.pane .actions hcm-button')).toHaveLength(0);
        expect(deep(element, '[role="alert"]').textContent).toContain('there is no earlier version');
        deep(deep(element, 'hcm-list-detail'), '.back hcm-button').click();
        expect(history.named('select')).toEqual(['select null']);
    });
});

describe('<hcm-history-page>: its other states and the values as text', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_withoutAStoreNothingShowsAndTheVersionsListRetriesAndLoadsMore', async () => {
        const empty = await page('history', null);
        expect(empty.element.shadowRoot?.childElementCount).toBe(0);
        cleanup();

        const history = area(
            historyState({
                document: documentView({ entries: { ...ready([]), status: 'error', failure: { kind: 'failed', code: 'internal' } } }),
            }),
        );
        const { element } = await page('history', history, { params: ['poi', 'gara'] });
        deep(element, '.pane .actions hcm-button').click();
        history.set({ document: documentView({ entries: ready([historyItem()], { hasMore: true }) }) });
        await updated(element);
        deep(deep(element, '.more'), 'hcm-button').click();

        expect(history.calls.filter((call) => !call.startsWith('open'))).toEqual(['retry', 'more']);
    });

    it('badPath_cancellingTheRevertQuestionRevertsNothing', async () => {
        const history = area(historyState({ document: documentView(), changes: [] }));
        const { element } = await page('history', history, { params: ['poi', 'gara'] });

        deep(element, '.pane .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.cancel').click();
        await updated(element);

        expect(history.named('revert')).toEqual([]);
        expect(deepText(element)).toContain('No field changed.');
    });

    it('badPath_anAddressWithoutADocumentAndTheListsStates', async () => {
        const deleted = area(
            historyState({ document: documentView({ current: { status: 'ready', doc: null, reconnecting: false, failure: null } }) }),
        );
        const shown = await page('history', deleted, { params: ['poi', 'gara'] });
        expect(deep(shown.element, '.tag').textContent).toBe('Deleted now');
        cleanup();

        const history = area(
            historyState({
                document: documentView({
                    document: null,
                    entries: ready([]),
                    current: { status: 'ready', doc: null, reconnecting: false, failure: null },
                }),
            }),
        );
        const { element } = await page('history', history, { params: ['city', 'cluj'] });
        expect(deep(element, '.list-head h2').textContent).toBe('Versions');
        expect(deepAll(element, '.tag')).toHaveLength(0);
        expect(deepAll(element, 'hcm-empty-state').map((state) => (state as HTMLElement & { text: string }).text)).toEqual([
            'No versions at this address.',
            'No versions at this address.',
        ]);

        history.set({ document: null, recent: { ...LOADING } });
        await updated(element);
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(1);
        history.set({ recent: ready([], { reconnecting: true }), refusal: { key: 'apiError.history.notFound' } });
        await updated(element);
        expect(deepText(element)).toContain('No changes yet.');
        expect(deepAll(element, '[role="alert"]')).toHaveLength(1);
        history.set({ recent: { ...ready([]), status: 'error', failure: { kind: 'failed', code: 'internal' } } });
        await updated(element);
        deep(element, '.pane .actions hcm-button').click();
        history.set({ recent: ready([historyItem()], { hasMore: true }) });
        await updated(element);
        deep(deep(element, '.more'), 'hcm-button').click();

        expect(history.calls.filter((call) => !call.startsWith('open'))).toEqual(['retry', 'more']);
    });

    it('happyPath_aDeletionsEntryOffersRestoreAndANameIsTheDocumentsInTheAdminsLanguage', async () => {
        const deleted = historyItem({ entryId: '1760800000000-delete', action: 'delete', previous: { title: { ro: 'Gara' } } });
        const history = area(
            historyState({ document: documentView({ entries: ready([deleted]) }), selected: deleted.entryId, changes: [] }),
        );
        const { element } = await page('history', history, { params: ['poi', 'gara'] });

        expect(deep(element, '.pane .actions hcm-button').textContent).toContain('Restore');
        expect(currentName({ title: { ro: 'Gara', en: 'Station' } })).toEqual({ ro: 'Gara', en: 'Station' });
        expect(currentName({ label: { ro: 'Corona 1968' } })).toEqual({ ro: 'Corona 1968' });
        expect([currentName({ name: { ro: 7 } }), currentName(undefined), currentName(null)]).toEqual([null, null, null]);
        expect(nameText('en', historyItem({ name: { ro: 'Gara', en: 'Station' } }))).toBe('Station');
        expect(nameText('en', historyItem({ name: { ro: 'Gara' } }))).toBe('Gara');
    });

    it('happyPath_valuesAreTextInEveryShape', () => {
        expect(describeValue('en', 'title', { ro: 'Gara', en: 'Station' })).toBe('RO: Gara · EN: Station');
        expect(describeValue('en', 'title', { ro: 'Gara' })).toBe('RO: Gara');
        expect(describeValue('en', 'x', undefined)).toBe('(none)');
        expect(describeValue('ro', 'published', false)).toBe('nu');
        expect(describeValue('en', 'opacity', 0.75)).toBe('75%');
        expect(describeValue('en', 'year', 1980)).toBe('1980');
        expect(describeValue('ro', 'yearEnd', 2001)).toBe('2001');
        expect(describeValue('en', 'count', 1980)).toBe('1,980');
        expect(describeValue('en', 'description', '<script>x</script>')).toBe('<script>x</script>');
        expect(describeValue('en', 'updatedAt', { seconds: 1_760_000_000, nanoseconds: 0 })).toMatch(/2025/);
        expect(describeValue('en', 'geometry', { type: 'Point', point: { lat: 1, lng: 2 } })).toBe('Point, positions: 1');
        expect(describeValue('en', 'geometry', { type: 'LineString', points: [{}, {}, {}] })).toBe('Line, positions: 3');
        expect(describeValue('en', 'geometry', { type: 'Polygon', rings: [{ points: [{}, {}, {}, {}] }, { other: true }] })).toBe(
            'Area, positions: 4',
        );
        expect(describeValue('en', 'geometry', { type: 'Polygon' })).toBe('Area, positions: 0');
        expect(describeValue('ro', 'geometry', { type: 'LineString', points: [{}, {}] })).toBe('Linie, poziții: 2');
        expect(describeValue('en', 'geometry', { type: 'MultiPoint' })).toBe('MultiPoint, positions: 0');
        expect(describeValue('en', 'adjustments', { contrast: 0.2, saturation: 'x' })).toBe('contrast 20%, saturation ?');
        expect(describeValue('en', 'adjustments', {})).toBe('(none)');
        expect(describeValue('en', 'theme', { seedColor: '#6750a4' })).toBe('city colour #6750a4');
        expect(describeValue('en', 'location', { lat: 44.4268, lng: 26.1025 })).toBe('44.4268, 26.1025');
        expect(describeValue('en', 'links', [1, 2])).toBe('items: 2');
        expect(describeValue('en', 'bounds', { south: 1 })).toBe('{"south":1}');
        expect(describeValue('en', 'blob', { text: 'x'.repeat(300) })).toHaveLength(201);
        expect(describeValue('en', 'theme', { other: 1 })).toBe('{"other":1}');
        expect(nameText('ro', historyItem({ name: { ro: 'Gara' } }))).toBe('Gara');
    });
});
