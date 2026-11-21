// M20's elements (docs/research/M20-import-local.md §8): the Upload view's Import local files card and an archive's report, over a
// fake feed that a fake app's Imagery store hands out, as the admin's `ImageryIntents.archive` does.
import type { ArchiveSeries } from '@hcm/shared';
import { translateAdminArchive, type AdminArchiveKey } from '@hcm/shared/admin-archive';
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import type {
    ArchiveFeedPort,
    ArchiveHostPort,
    ArchiveViewPort,
    LocalFilePort,
    SeriesProgressPort,
} from '../../../src/admin/archive/archive-port.js';
import { sizeText } from '../../../src/admin/archive/archive-element.js';
import { archiveName, pickedFiles } from '../../../src/admin/archive/hcm-archive-panel.js';
import { defineArchiveElements } from '../../../src/admin/archive/define.js';
import { overallPercent, stateText, totalText } from '../../../src/admin/archive/series-text.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';

defineArchiveElements();
defineArchiveElements();

const ARCHIVE = 'ar-0123456789abcdef';

function t(key: AdminArchiveKey, params?: Readonly<Record<string, string>>, locale: 'ro' | 'en' = 'en'): string {
    return translateAdminArchive(locale, key, params);
}

function series(n: number, more: Partial<ArchiveSeries> = {}): ArchiveSeries {
    return {
        seriesId: `s-${String(n).padStart(12, '0')}`,
        class: 'grid',
        title: `Plan ${String(n)}`,
        year: 1911,
        files: 4545,
        bytes: 4_000_000,
        action: 'import',
        encoding: 'lineart',
        rights: { licence: 'PD', state: 'clear', year: '1911' },
        estimate: { maxzoom: 19, tilesBytes: 1_000_000_000, minutes: 75, auto: 'likely' },
        order: n,
        ...more,
    };
}

const SERIES = [
    series(0),
    series(1, {
        class: 'single',
        title: 'IPB 1974',
        year: 1974,
        yearLabel: '1962–1978',
        rights: { licence: 'unknown', state: 'needs-confirmation', year: '1974' },
    }),
    series(2, {
        action: 'skip',
        reason: 'do-not-publish',
        title: 'Oltean',
        estimate: { maxzoom: 16, tilesBytes: 0, minutes: 0, auto: 'points' },
    }),
];

function view(changes: Partial<ArchiveViewPort> = {}): ArchiveViewPort {
    return {
        ...{ status: 'ready', failure: null, connected: true, importUrl: 'http://127.0.0.1:8765/import?lat=44.4300' },
        archives: [{ id: ARCHIVE, name: 'harti.zip', files: 5703, bytes: 9_000_000_000, series: 64, imported: false }],
        open: {
            id: ARCHIVE,
            status: 'ready',
            report: {
                name: 'harti.zip',
                files: 5703,
                bytes: 9_000_000_000,
                series: SERIES,
                skipped: [['not-a-map', 50]],
                imported: false,
                importedSeries: [],
            },
        },
        edits: {
            [SERIES[0]?.seriesId ?? '']: { include: true, title: 'Plan 0', year: '1911', confirmedBy: null },
            [SERIES[1]?.seriesId ?? '']: { include: true, title: 'IPB 1974', year: '1974', confirmedBy: null },
            [SERIES[2]?.seriesId ?? '']: { include: false, title: 'Oltean', year: '1911', confirmedBy: null },
        },
        ...{ progress: {}, importing: false, result: null, refusal: null },
        local: { phase: 'idle', percent: 0, done: 0, total: 0, error: null },
        ...changes,
    };
}

class FakeFeed implements ArchiveFeedPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: ArchiveViewPort) => void>();

    constructor(public state: ArchiveViewPort) {}

    readonly intents = {
        open: (id: string | null): void => {
            this.calls.push(`open ${String(id)}`);
        },
        setInclude: (id: string, on: boolean): void => {
            this.calls.push(`include ${id} ${String(on)}`);
        },
        setTitle: (id: string, title: string): void => {
            this.calls.push(`title ${id} ${title}`);
        },
        setYear: (id: string, year: string): void => {
            this.calls.push(`year ${id} ${year}`);
        },
        confirmRights: (id: string, by: string): void => {
            this.calls.push(`rights ${id} ${by}`);
        },
        import: (): Promise<boolean> => {
            this.calls.push('import');
            return Promise.resolve(true);
        },
        retry: (): void => {
            this.calls.push('retry');
        },
        importLocal: (files: readonly LocalFilePort[], source: 'folder' | 'zip', name: string): Promise<void> => {
            this.calls.push(`importLocal ${source} ${name} ${files.map((each) => each.path).join(',')}`);
            return Promise.resolve();
        },
        cancelLocal: (): Promise<void> => {
            this.calls.push('cancelLocal');
            return Promise.resolve();
        },
    };

    subscribe(listener: (state: ArchiveViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    start(): void {
        this.calls.push('start');
    }

    stop(): void {
        this.calls.push('stop');
    }

    set(changes: Partial<ArchiveViewPort>): void {
        this.state = { ...this.state, ...changes };
        for (const listener of this.#listeners) {
            listener(this.state);
        }
    }
}

class FakeHost implements ArchiveHostPort {
    readonly feeds: FakeFeed[] = [];
    fails = false;

    constructor(readonly state: ArchiveViewPort = view()) {}

    readonly content = {
        imagery: {
            intents: {
                archive: (): Promise<FakeFeed> => {
                    if (this.fails) {
                        return Promise.reject(new Error('chunk lost'));
                    }
                    const feed = new FakeFeed(this.state);
                    this.feeds.push(feed);
                    return Promise.resolve(feed);
                },
            },
        },
    };

    get feed(): FakeFeed {
        const feed = this.feeds.at(-1);
        if (feed === undefined) {
            throw new Error('no feed yet');
        }
        return feed;
    }
}

async function settled(element: LitElement): Promise<LitElement> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await updated(element);
    return element;
}

async function panel(host: ArchiveHostPort | null, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    return settled(await fixture<LitElement>(html`<hcm-archive-panel .app=${host} locale=${locale}></hcm-archive-panel>`));
}

async function report(host: ArchiveHostPort, readOnly = false): Promise<LitElement> {
    return settled(
        await fixture<LitElement>(
            html`<hcm-archive-report .app=${host} locale="en" archive=${ARCHIVE} ?read-only=${readOnly}></hcm-archive-report>`,
        ),
    );
}

function button(element: Element, selector: string): HTMLElement & { disabled: boolean } {
    return deep(element, selector) as HTMLElement & { disabled: boolean };
}

const progress = (more: Partial<SeriesProgressPort>): SeriesProgressPort => ({
    ...{ versionId: 'job-0', state: 'processing', jobStatus: 'queued', waitReason: null, step: null, progress: null },
    ...{ help: null, errorM: null, thresholdM: null, ...more },
});

describe('<hcm-archive-panel>', () => {
    afterEach(cleanup);

    it('happyPath_aConnectedWorkerOpensItsImportPageAndTheArchivesOpenTheirReports @S-A121-HAPPY-PANEL', async () => {
        const host = new FakeHost();
        const element = await panel(host);

        const fallback = deep(element, 'a[data-fallback]') as HTMLAnchorElement;
        expect([fallback.href, fallback.target]).toEqual(['http://127.0.0.1:8765/import?lat=44.4300', '_blank']);
        expect(deepAll(element, 'hcm-button[data-choose]').map((each) => each.textContent.trim())).toEqual([
            t('adminArchive.local.folder'),
            t('adminArchive.local.zip'),
        ]);
        expect((deep(element, `a[data-archive="${ARCHIVE}"]`) as HTMLAnchorElement).getAttribute('href')).toBe(
            `#/imagery/archive/${ARCHIVE}`,
        );
        expect(deepText(element)).toContain(t('adminArchive.row', { series: '64', files: '5,703', size: sizeText('en', 9_000_000_000) }));
        expect(await axeViolations(element)).toEqual([]);
        element.remove();
        expect(host.feed.calls).toEqual(['start', 'stop']);
    });

    it('badPath_noWorkerSaysToStartItFirstAndAFailedListOffersTryAgain @S-A121-BAD-NO-WORKER', async () => {
        const host = new FakeHost(view({ connected: false, archives: [] }));
        const element = await panel(host, 'ro');

        expect(deepAll(element, '[data-choose]')).toHaveLength(0);
        expect(deep(element, '[data-state="no-worker"]').textContent).toBe(t('adminArchive.noWorker', undefined, 'ro'));
        expect(deep(element, '[data-state="no-archives"]').textContent).toBe(t('adminArchive.none', undefined, 'ro'));
        host.feed.set({ status: 'error', failure: { kind: 'unavailable', code: 'unavailable' } });
        await updated(element);
        deep(deep(element, 'hcm-button'), 'button').click();
        expect(host.feed.calls).toContain('retry');
    });

    it('happyPath_aFolderPickedInThisTabGoesToTheWorkerWithItsProgressAndCancel @S-A121-HAPPY-LOCAL-TAB', async () => {
        const host = new FakeHost();
        const element = await panel(host);
        const input = deep(element, 'input[data-pick="folder"]') as HTMLInputElement;
        const picked = new DataTransfer();
        picked.items.add(new File(['a'], '1911.jpg'));
        input.files = picked.files;
        input.dispatchEvent(new Event('change'));

        host.feed.set({ local: { phase: 'upload', percent: 42, done: 0, total: 1, error: null } });
        await settled(element);
        const sending = deep(element, '[data-local="upload"] [role="status"]').textContent;
        host.feed.set({ local: { phase: 'scan', percent: 2, done: 120, total: 5703, error: null } });
        await settled(element);
        const reading = deep(element, '[data-local="scan"] [role="status"]').textContent;
        expect((deepAll(element, 'hcm-button[data-choose]')[0] as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        deepAll(element, '[data-local="scan"] hcm-button')[0]?.click();
        expect(await axeViolations(element)).toEqual([]);

        expect(host.feed.calls).toContain('importLocal folder 1911.jpg 1911.jpg');
        expect(host.feed.calls).toContain('cancelLocal');
        expect(sending).toBe(t('adminArchive.local.upload', { percent: '42' }));
        expect(reading).toBe(t('adminArchive.local.scan', { done: '120', total: '5,703', percent: '2' }));
    });

    it.each([
        ['notPaired', 'adminArchive.local.notPaired'],
        ['unreachable', 'adminArchive.local.unreachable'],
        ['refused', 'adminArchive.local.refused'],
    ] as const)('badPath_anImportThatStopped_%s_saysWhy @S-A121-BAD-LOCAL-TAB', async (error, key) => {
        const host = new FakeHost(view({ local: { phase: 'failed', percent: 0, done: 0, total: 0, error } }));
        const element = await panel(host);

        expect(deep(element, '[data-local="failed"]').textContent).toBe(t('adminArchive.local.failed', { why: t(key) }));
    });

    it('badPath_aScanErrorCodeIsShownAsItCame_andCancelledAndDoneSaySo', async () => {
        const host = new FakeHost(view({ local: { phase: 'failed', percent: 0, done: 0, total: 0, error: 'apiError.internal' } }));
        const element = await panel(host);
        expect(deep(element, '[data-local="failed"]').textContent).toContain('apiError.internal');
        host.feed.set({ local: { phase: 'cancelled', percent: 0, done: 0, total: 0, error: null } });
        await settled(element);
        expect(deep(element, '[data-local="cancelled"]').textContent).toBe(t('adminArchive.local.cancelled'));
        host.feed.set({ local: { phase: 'done', percent: 100, done: 0, total: 0, error: null } });
        await settled(element);
        expect(deep(element, '[data-local="done"]').textContent).toBe(t('adminArchive.local.done'));
        deep(element, 'hcm-button[data-choose="zip"]').click();
    });

    it('happyPath_anArchiveThatArrivesWhileTheCardIsOpenOpensItsReport @S-A121-HAPPY-BUDGET', async () => {
        const host = new FakeHost();
        const element = await panel(host);
        const opened: string[] = [];
        element.addEventListener('hcm-archive-arrived', (event) => opened.push((event as CustomEvent<{ id: string }>).detail.id));
        const fresh = { id: 'ar-ffffffffffffffff', name: 'more.zip', files: 1, bytes: 1, series: 1, imported: false };

        host.feed.set({ archives: [fresh, ...host.state.archives] });
        await updated(element);
        host.feed.set({ archives: [{ ...fresh, id: 'ar-eeeeeeeeeeeeeeee', imported: true }, fresh, ...host.state.archives] });
        await updated(element);

        expect(opened).toEqual(['ar-ffffffffffffffff']);
    });

    it('badPath_noAppOrAChunkThatDoesNotLoadShowsTheTitleAlone', async () => {
        const failing = new FakeHost();
        failing.fails = true;
        const element = await panel(failing);
        const alone = await panel(null);

        expect(deepAll(element, '[data-choose]')).toHaveLength(0);
        expect(deepText(alone)).toContain(t('adminArchive.title'));
    });
});

describe('<hcm-archive-report>', () => {
    afterEach(cleanup);

    it('happyPath_theReportItsSeriesTheTotalAndOneImport @S-A121-HAPPY-IMPORT', async () => {
        const host = new FakeHost();
        const element = await report(host);
        const text = deepText(element);

        expect(host.feed.calls).toEqual(['start', `open ${ARCHIVE}`]);
        expect(text).toContain(t('adminArchive.action.grid', { files: '4,545' }));
        expect(text).toContain(t('adminArchive.action.skip', { reason: t('adminArchive.reason.do-not-publish') }));
        expect(text).toContain('IPB 1974, 1962–1978');
        expect(text).toContain(t('adminArchive.total', { jobs: '2', size: sizeText('en', 2_000_000_000) }));
        expect(deep(element, '[data-rights="needs-confirmation"]').textContent).toBe(t('adminArchive.rights.needs-confirmation'));
        expect(await axeViolations(element)).toEqual([]);

        const id = SERIES[0]?.seriesId ?? '';
        const title = deep(element, `#${id}-title`) as HTMLInputElement;
        title.value = 'Planul IGA';
        title.dispatchEvent(new Event('input'));
        const year = deep(element, `#${id}-year`) as HTMLInputElement;
        year.value = '1912';
        year.dispatchEvent(new Event('input'));
        deep(deep(element, `[data-series="${id}"]`), 'hcm-switch').dispatchEvent(
            new CustomEvent('hcm-change', { detail: { checked: false } }),
        );
        const by = deep(element, `#${SERIES[1]?.seriesId ?? ''}-rights`) as HTMLInputElement;
        by.value = 'Idei Urbane';
        deep(button(element, '[data-confirm-rights]'), 'button').click();
        deep(button(element, '[data-import]'), 'button').click();

        expect(host.feed.calls.slice(2)).toEqual([
            `title ${id} Planul IGA`,
            `year ${id} 1912`,
            `include ${id} false`,
            `rights ${SERIES[1]?.seriesId ?? ''} Idei Urbane`,
            'import',
        ]);
        host.feed.set({ result: { today: 2, waiting: 0 }, importing: true });
        await updated(element);
        expect(deep(element, '[data-result]').textContent).toBe(t('adminArchive.imported', { today: '2' }));
        expect(button(element, '[data-import]').disabled).toBe(true);
    });

    it('badPath_aYearALayerCannotShowDisablesImportAndSaysWhy @S-A121-BAD-YEAR-EMPTY', async () => {
        const id = SERIES[0]?.seriesId ?? '';
        const base = view();
        const host = new FakeHost(
            view({ edits: { ...base.edits, [id]: { include: true, title: 'Plan 0', year: '', confirmedBy: null } } }),
        );
        const element = await report(host);

        expect(button(element, '[data-import]').disabled).toBe(true);
        expect(deep(element, `[data-series="${id}"] [data-year-help]`).textContent).toBe(t('adminArchive.yearInvalid'));
        host.feed.set({ edits: {}, refusal: { key: 'apiError.imagery.archiveImported' } });
        await updated(element);
        expect(deep(element, '[data-total]').textContent).toBe(t('adminArchive.totalNone'));
        expect(deep(element, '[role="alert"] .alert').textContent).not.toBe('');
        const confirmed = new FakeHost(
            view({
                edits: { [SERIES[1]?.seriesId ?? '']: { include: true, title: 'IPB 1974', year: '1974', confirmedBy: 'Idei Urbane' } },
            }),
        );
        const other = await report(confirmed, true);
        expect(deep(other, '[data-rights-confirmed]').textContent).toBe(t('adminArchive.rights.confirmed', { by: 'Idei Urbane' }));
        expect(button(other, '[data-import]').disabled).toBe(true);
        expect(deep(other, '[data-total]').textContent).toBe(totalText('en', SERIES.slice(1, 2)));
        expect(totalText('en', SERIES.slice(1, 2))).not.toContain('days');
    });

    it('happyPath_anImportedArchiveShowsEachSeriesWhereItStandsAndOpensItsVersion @S-A121-HAPPY-PROGRESS', async () => {
        const base = view();
        const open = {
            ...base.open,
            id: ARCHIVE,
            status: 'ready' as const,
            report: {
                ...base.open?.report,
                ...{ name: 'harti.zip', files: 1, bytes: 1, series: SERIES, skipped: [], imported: true },
                importedSeries: [SERIES[0]?.seriesId ?? '', SERIES[1]?.seriesId ?? ''],
            },
        };
        const host = new FakeHost(
            view({
                open,
                progress: {
                    [SERIES[0]?.seriesId ?? '']: progress({ state: 'awaiting_approval', errorM: 4.2, thresholdM: 15 }),
                    [SERIES[1]?.seriesId ?? '']: progress({
                        state: 'needs_gcps',
                        help: { reason: 'frame-not-found', note: 'no neat line' },
                    }),
                },
            }),
        );
        const element = await report(host);

        expect(deepAll(element, '[data-progress]')).toHaveLength(2);
        expect(deepAll(element, '[data-import]')).toHaveLength(0);
        expect(deep(element, '[data-overall]').textContent).toBe(t('adminArchive.local.overall', { percent: '100' }));
        expect(deepText(element)).toContain(t('adminArchive.state.approval', { error: '4.2', threshold: '15' }));
        expect(deepText(element)).toContain(t('adminArchive.state.points', { note: t('adminArchive.help.frame-not-found') }));
        expect((deep(element, '[data-progress] a') as HTMLAnchorElement).getAttribute('href')).toBe('#/imagery/version/job-0');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_loadingNotFoundAndAFailedReport @S-A121-BAD-NOT-FOUND', async () => {
        const host = new FakeHost(view({ open: { id: ARCHIVE, status: 'loading', report: null } }));
        const element = await report(host);
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(1);

        host.feed.set({ open: { id: ARCHIVE, status: 'ready', report: null } });
        await updated(element);
        expect(deep(element, '[data-state="not-found"]').textContent).toBe(t('adminArchive.notFound'));
        host.feed.set({ open: { id: ARCHIVE, status: 'error', report: null }, failure: { kind: 'unavailable', code: 'unavailable' } });
        await updated(element);
        deep(deep(element, 'hcm-button'), 'button').click();
        (element as LitElement & { archive: string }).archive = '';
        await updated(element);
        expect(host.feed.calls).toEqual(['start', `open ${ARCHIVE}`, 'retry', 'open null']);
    });
});

describe('<hcm-archive-report>, the rest', () => {
    afterEach(cleanup);

    it('happyPath_aSeriesStartedOverIsOfferedAgainBelowTheOthersProgress @S-A125-HAPPY-DELETE-VERSION', async () => {
        const base = view();
        const first = SERIES[0]?.seriesId ?? '';
        const open = {
            ...base.open,
            id: ARCHIVE,
            status: 'ready' as const,
            report: {
                ...{ name: 'harti.zip', files: 1, bytes: 1, series: SERIES, skipped: [], imported: true },
                importedSeries: [first],
            },
        };
        const host = new FakeHost(view({ open, progress: { [first]: progress({ state: 'awaiting_approval' }) } }));
        const element = await report(host);

        expect(deepAll(element, '[data-progress]').map((row) => row.getAttribute('data-progress'))).toEqual([first]);
        expect(deepAll(element, '[data-series]').map((row) => row.getAttribute('data-series'))).toEqual([
            SERIES[1]?.seriesId,
            SERIES[2]?.seriesId,
        ]);
        expect(deepAll(element, '[data-import]')).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_noAppNoArchiveNoSkippedFilesASeriesWithoutEditAndAProgressWithoutVersion', async () => {
        const alone = await settled(await fixture<LitElement>(html`<hcm-archive-report locale="en"></hcm-archive-report>`));
        expect(deepAll(alone, 'hcm-loading-indicator')).toHaveLength(1);

        const report = { name: 'harti.zip', files: 1, bytes: 1, series: SERIES, skipped: [], imported: false, importedSeries: [] };
        const host = new FakeHost(view({ open: { id: ARCHIVE, status: 'ready', report }, edits: {} }));
        const element = await settled(await fixture<LitElement>(html`<hcm-archive-report .app=${host} locale="en"></hcm-archive-report>`));
        expect(host.feed.calls).toEqual(['start', 'open null']);
        expect(deepAll(element, '[data-skipped]')).toHaveLength(0);
        expect(deepAll(element, 'hcm-switch')).toHaveLength(0);

        const id = SERIES[0]?.seriesId ?? '';
        host.feed.set({
            open: { id: ARCHIVE, status: 'ready', report: { ...report, imported: true } },
            progress: { [id]: progress({ versionId: null }) },
        });
        await updated(element);
        expect(deepAll(element, '[data-progress] a')).toHaveLength(0);
    });
});

describe('stateText', () => {
    it('happyPath_everyStateInOneLine', () => {
        const lines = [
            progress({ waitReason: 'daily' }),
            progress({}),
            progress({ jobStatus: 'running', step: 'place', progress: 0.25 }),
            progress({ jobStatus: 'starting' }),
            progress({ state: 'needs_gcps' }),
            progress({ state: 'awaiting_approval', errorM: 31.04 }),
            progress({ state: 'publishing' }),
            progress({ state: 'published' }),
            progress({ state: 'failed' }),
            progress({ state: 'rejected' }),
            progress({ state: null }),
        ].map((each) => stateText('en', each));

        expect(lines).toEqual([
            t('adminArchive.state.daily'),
            t('adminArchive.state.queued'),
            t('adminArchive.state.running', { step: 'place', percent: '25' }),
            t('adminArchive.state.running', { step: '…', percent: '0' }),
            t('adminArchive.state.points', { note: t('adminArchive.help.low-confidence') }),
            t('adminArchive.state.approvalNoScale', { error: '31' }),
            t('adminArchive.state.publishing'),
            t('adminArchive.state.published'),
            t('adminArchive.state.failed'),
            t('adminArchive.state.cancelled'),
            t('adminArchive.state.queued'),
        ]);
        expect(sizeText('en', 512)).toBe('512 byte');
    });
});

describe('overallPercent', () => {
    it('happyPath_aRunningSeriesCountsItsShareAndAnEndedOneAllOfIt', () => {
        expect(overallPercent([progress({ state: 'processing', progress: 0.5 }), progress({ state: 'published' })])).toBe(75);
        expect(overallPercent([progress({ state: null, progress: null })])).toBe(0);
    });

    it('badPath_noSeriesIsNothingDone', () => {
        expect(overallPercent([])).toBe(0);
    });
});

describe('the picked files', () => {
    it('happyPath_aFolderKeepsEachFilesPathAndIsNamedByItsTopFolder', () => {
        const inFolder = { webkitRelativePath: 'Harti/1911.jpg', name: '1911.jpg' } as File;

        expect(pickedFiles([inFolder]).map((each) => each.path)).toEqual(['Harti/1911.jpg']);
        expect([archiveName('Harti/1911.jpg', 'folder'), archiveName('harti.zip', 'zip'), archiveName('a.jpg', 'folder')]).toEqual([
            'Harti',
            'harti.zip',
            'a.jpg',
        ]);
    });

    it('badPath_noListAndAnEmptyPickSendNothing', async () => {
        expect(pickedFiles(null)).toEqual([]);
        const host = new FakeHost(view({ local: { phase: 'failed', percent: 0, done: 0, total: 0, error: null } }));
        const element = await panel(host);
        const input = deep(element, 'input[data-pick="zip"]') as HTMLInputElement;
        input.dispatchEvent(new Event('change'));

        expect(host.feed.calls.filter((call) => call.startsWith('importLocal'))).toEqual([]);
        expect(deep(element, '[data-local="failed"]').textContent).toBe(t('adminArchive.local.failed', { why: '' }));
    });
});
