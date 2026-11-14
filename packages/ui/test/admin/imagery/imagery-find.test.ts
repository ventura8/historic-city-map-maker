import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState } from '../../../src/admin/imagery/imagery-port.js';
import { frameText, yearFilter } from '../../../src/admin/imagery/scene-list.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, nth, ready, scene, versionItem } from './fixtures.js';

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

describe('<hcm-imagery-page>: Find', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theRankedScenesWithThumbnailScoreReasonsAndChips', async () => {
        const { element, area } = await imageryPage();

        const rows = deepAll(element, 'a.row.scene');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/imagery/scene/DS1035-1057DA023', '#/imagery/scene/DS2']);
        expect(rows[0]?.textContent).toContain('KH-4A Corona · Jul 12, 1966');
        expect(rows[0]?.textContent).toContain('Score 87 of 100');
        expect(rows[0]?.textContent).toContain('Covers 94% of the city');
        expect(rows[0]?.textContent).toContain('Free');
        expect(rows[1]?.textContent).toContain('Needs ordering');
        expect(deepAll(element, 'img.thumb')).toHaveLength(1);
        expect(deepText(element)).toContain('Choose a scene or a version to see it here.');
        expect(area.named('open')).toEqual(['open []']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theFiltersAndTheSearchCallTheirIntents', async () => {
        const { element, area } = await imageryPage();

        click(nth(element, '.filters hcm-chip', 0));
        click(nth(element, '.filters hcm-chip', 1));
        click(nth(element, '.filters hcm-chip', 3));
        const from = deep(element, '#imagery-fromYear') as HTMLInputElement;
        from.value = '1960';
        from.dispatchEvent(new Event('change'));
        const to = deep(element, '#imagery-toYear') as HTMLInputElement;
        to.value = '';
        to.dispatchEvent(new Event('change'));
        click(deep(deep(element, '[data-view="find"] .actions'), 'hcm-button'));

        expect(calls(area)).toEqual([
            'setFilters {"freeOnly":false}',
            'setFilters {"hideRejected":false}',
            'setFilters {"datasets":["declassii"]}',
            'setFilters {"fromYear":1960}',
            'setFilters {"toYear":null}',
            'search',
        ]);
        expect([yearFilter(' 1966 '), yearFilter('19x'), yearFilter('')]).toEqual([1966, null, null]);
    });

    it('happyPath_aChosenDatasetChipTakesItsDatasetOut', async () => {
        const { element, area } = await imageryPage(imageryState({ filters: { ...imageryState().filters, datasets: ['corona2'] } }));

        click(nth(element, '.filters hcm-chip', 2));

        expect(calls(area)).toEqual(['setFilters {"datasets":[]}']);
        expect((deep(element, '#imagery-fromYear') as HTMLInputElement).value).toBe('');
    });

    it('happyPath_theSearchSaysHowItWentAndWhichDatasetsDidNotAnswer', async () => {
        const { element, area } = await imageryPage(
            imageryState({ search: { phase: 'searching', found: null, added: null, failedDatasets: [], error: null } }),
        );
        const searching = [deepAll(element, 'hcm-progress').length, deepText(element)];

        area.set({ search: { phase: 'done', found: 12, added: 5, failedDatasets: ['declassiii'], error: null }, usgs: 'pending' });
        await updated(element);

        expect(searching[0]).toBe(1);
        expect(searching[1]).toContain('Searching the USGS scenes over the city…');
        expect(deepText(element)).toContain('Found 12 scenes, 5 of them new.');
        expect(deep(element, '[data-failed-datasets]').textContent).toContain('Hexagon panoramic (Declass 3)');
        expect(deep(element, '[data-state="downloads-pending"]').textContent).toContain('USGS has not approved downloads yet');
    });

    it('badPath_aRefusedSearchShowsItsReason', async () => {
        const { element } = await imageryPage(
            imageryState({
                search: { phase: 'failed', found: null, added: null, failedDatasets: [], error: { key: 'apiError.usgs.maintenance' } },
            }),
        );

        expect(deep(element, '[data-state="search-error"]').getAttribute('role')).toBe('alert');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutUsgsTheViewLeadsToSetup', async () => {
        const { element } = await imageryPage(imageryState({ usgs: 'missing' }));

        expect(deep(element, '[data-state="usgs-missing"] a').getAttribute('href')).toBe('#/setup/usgs');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_noScenesNoneTheFiltersKeepLoadingAndAFailedRead', async () => {
        const { element, area } = await imageryPage(imageryState({ scenes: ready([]), visible: [] }));
        const none = deepText(element);
        area.set({ scenes: ready([scene()]), visible: [] });
        await updated(element);
        const filtered = deepText(element);
        area.set({ scenes: { ...ready([]), status: 'loading' }, visible: [] });
        await updated(element);
        const loading = deepAll(element, 'hcm-loading-indicator').length;
        area.set({ scenes: { ...ready([]), status: 'error', failure: { kind: 'failed', code: 'internal' } }, visible: [] });
        await updated(element);
        click(button(element, 'Try again'));

        expect(none).toContain('No scenes yet. Search USGS');
        expect(filtered).toContain('No scene matches the filters.');
        expect(loading).toBe(1);
        expect(calls(area)).toEqual(['retry']);
    });

    it('happyPath_moreScenesAndTheTabs', async () => {
        const { element, area } = await imageryPage(imageryState({ scenes: ready([scene()], { hasMore: true }), visible: [scene()] }));

        click(deep(deep(element, '.more'), 'hcm-button'));
        const segments = deep(element, 'hcm-segmented-button');
        deepAll(segments, 'button')[1]?.click();

        expect(calls(area)).toEqual(['more', 'setTab "work"']);
        // Work counts what it lists: the version waiting for the admin and the one in progress (finding 54).
        expect(deepAll(segments, 'button').map((segment) => segment.textContent.trim())).toEqual(['Find', 'Work (2)', 'Upload']);
    });
});

describe('<hcm-imagery-page>: the rows and the Work count of the live test 2026-11-01', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_anImportRunningCountsInWorkLiveAndNothingLeftIsZero', async () => {
        const running = versionItem({ id: 'job-new', state: 'processing', needsYou: false });
        const { element, area } = await imageryPage(imageryState({ versions: ready([running]) }));
        const work = (): string | undefined => deepAll(deep(element, 'hcm-segmented-button'), 'button')[1]?.textContent.trim();
        const first = work();
        area.set({ versions: ready([]) });
        await updated(element);

        expect([first, work()]).toEqual(['Work (1)', 'Work (0)']);
    });

    it('happyPath_twinsOfTheSameDaySayTheirIdCameraAndFrame', async () => {
        const day = { sensorName: 'KH-4A Corona', date: '1964-06-18', year: 1964 };
        const twins = ['DS1012-1043DA015', 'DS1012-1043DF015', 'DS1012-1043DA016'].map((id) => scene({ ...day, id, displayId: id }));
        const mapping = scene({ id: 'DZB1211-500043L007001', displayId: 'DZB1211-500043L007001', sensorName: 'KH-9 Hexagon mapping' });
        const visible = [...twins, mapping];
        const { element } = await imageryPage(imageryState({ scenes: ready(visible), visible, browse: {} }));

        const lines = deepAll(element, '[data-identity]').map((line) => line.textContent);
        expect(lines).toEqual([
            'DS1012-1043DA015 · aft camera, frame 15',
            'DS1012-1043DF015 · forward camera, frame 15',
            'DS1012-1043DA016 · aft camera, frame 16',
            'DZB1211-500043L007001 · frame 7',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anIdThatSaysNoCameraOrFrameShowsTheIdAloneInRomanianToo', async () => {
        const visible = [scene(), scene({ id: 'DS2', displayId: 'DS2', date: '1968-12-11' })];
        const { element } = await imageryPage(imageryState({ scenes: ready(visible), visible }), { locale: 'ro' });

        expect(deepAll(element, '[data-identity]').map((line) => line.textContent)).toEqual([
            'DS1035-1057DA023 · camera din spate, cadrul 23',
            'DS2',
        ]);
        expect([frameText('ro', 'D3C1216-200467F021'), frameText('en', 'X1'), frameText('en', 'DS1-2DZ023')]).toEqual([
            'camera din față, cadrul 21',
            '',
            '',
        ]);
    });

    it('badPath_aRowWhosePreviewFailedSaysSoAndOneComingShowsThePlaceholder', async () => {
        const failed = { status: 'failed' as const, error: { key: 'apiError.imagery.browseUnavailable' as const } };
        const { element } = await imageryPage(imageryState({ browse: { 'DS1035-1057DA023': failed, DS2: { status: 'loading' } } }));

        const unavailable = deep(element, '[data-scene="DS1035-1057DA023"] [data-browse="unavailable"]');
        expect(deep(unavailable, 'hcm-icon').getAttribute('name')).toBe('broken_image');
        expect(deep(element, 'a[href$="/DS1035-1057DA023"]').textContent).toContain(
            'USGS did not answer when we asked for the preview. Try again in a few minutes.',
        );
        expect(deep(element, '[data-scene="DS2"] .thumb').getAttribute('aria-hidden')).toBe('true');
        expect(deepAll(element, 'img.thumb')).toHaveLength(0);
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-imagery-page>: Work', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theVersionsWaitingForTheAdminApartFromThoseInProgress', async () => {
        const { element } = await imageryPage(imageryState({ tab: 'work', detail: { kind: 'version', id: 'job-1966' } }));

        expect(deep(element, '#imagery-needs-you').textContent).toBe('Waiting for you');
        const rows = deepAll(element, '[data-version] a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/imagery/version/job-1966', '#/imagery/version/job-1980']);
        expect(rows[0]?.getAttribute('aria-current')).toBe('page');
        expect(rows[0]?.textContent).toContain('KH-4A Corona, 12 July 1966 · 1966');
        expect(rows[0]?.textContent).toContain('Awaiting approval');
        expect(rows[1]?.textContent).toContain('Processing, 40%');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anArgonFrameIsSetAsideTooCoarseWithItsReasonNeverAskedOfTheOwner', async () => {
        const argon = versionItem({ id: 'job-argon', state: 'needs_gcps', needsYou: false, tooCoarse: true });
        const { element } = await imageryPage(imageryState({ tab: 'work', versions: ready([versionItem(), argon]) }));

        expect(deep(element, '#imagery-too-coarse').textContent).toBe('Too coarse for streets (kept)');
        expect(deepText(element)).toContain('about 140 m a pixel; streets need 15 m');
        expect(deepAll(element, '#imagery-in-progress')).toHaveLength(0);
        expect(deep(element, '[data-version="job-argon"]').closest('section')?.getAttribute('aria-labelledby')).toBe('imagery-too-coarse');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aWaitingJobSaysWhyInWords', async () => {
        const jobs = {
            'job-1980': {
                id: 'job-1980',
                status: 'waiting_usgs' as const,
                progress: null,
                step: 'fetch',
                waitReason: 'usgs-maintenance' as const,
                retryAt: null,
                attempt: 1,
            },
        };
        const { element } = await imageryPage(imageryState({ tab: 'work', jobs }));

        expect(deepAll(element, '[data-version] a.row')[1]?.textContent).toContain('USGS is under maintenance');
    });

    it('happyPath_nothingInProgressLoadingAndAFailedRead', async () => {
        const { element, area } = await imageryPage(imageryState({ tab: 'work', versions: ready([]) }));
        const empty = deepText(element);
        area.set({ versions: { ...ready([]), status: 'loading' } });
        await updated(element);
        const loading = deepAll(element, 'hcm-loading-indicator').length;
        area.set({ versions: { ...ready([versionItem()]), status: 'error', failure: { kind: 'failed', code: 'internal' } } });
        await updated(element);
        click(button(element, 'Try again'));

        expect(empty).toContain('Nothing in progress.');
        expect(loading).toBe(1);
        expect(calls(area)).toEqual(['retry']);
    });
});

describe('<hcm-imagery-page>: Find, importing from the list and what to try', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aFreeScenesCardImportsInOneClick', async () => {
        const { element, area, app } = await imageryPage();

        const cards = deepAll(element, '.scene-card');
        const imports = cards.map((card) => deepAll(card, '.card-import hcm-button').length);
        click(deep(cards[0] ?? element, '.card-import hcm-button'));
        await updated(element);

        // The free scene has its Import, named after it; the scene to order has none.
        expect(imports).toEqual([1, 0]);
        expect(deep(cards[0] ?? element, '.card-import .visually-hidden').textContent).toContain('KH-4A Corona · Jul 12, 1966');
        expect(calls(area)).toEqual(['importScene "DS1035-1057DA023"']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","job-new"]}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aCardsRefusedImportSaysWhyAndNoCardImportsWhileOneRunsOrDownloadsWait', async () => {
        const refusal = { id: 'DS1035-1057DA023', notice: { key: 'apiError.imagery.dailyLimit', params: { limit: '10' } } } as const;
        const { element, area } = await imageryPage(imageryState({ importing: 'DS9', importRefusal: refusal }));
        const card = deep(element, '.scene-card');
        const busy = (deep(card, '.card-import hcm-button') as HTMLElement & { disabled: boolean }).disabled;
        const alert = deep(card, '.card-import .alert').textContent;
        area.set({ importing: null, importRefusal: null, usgs: 'pending' });
        await updated(element);

        expect([busy, alert]).toEqual([true, expect.stringContaining('10')]);
        expect(deepAll(element, '.card-import')).toEqual([]);
    });

    it('badPath_zeroResultsSayWhatToTry', async () => {
        const filters = { freeOnly: true, datasets: ['corona2'], fromYear: 1960, toYear: 1962, hideRejected: true } as const;
        const done = { phase: 'done', found: 0, added: 0, failedDatasets: [], error: null } as const;
        const { element, area } = await imageryPage(imageryState({ scenes: ready([]), visible: [], search: done, filters }));
        const guidance = deep(element, '[data-state="zero-results"]');
        const text = deepText(guidance);
        for (const label of ['Every year', 'All three collections', 'Show the scenes to order too']) {
            click(button(guidance, label));
        }
        const area1 = deep(guidance, 'a').getAttribute('href');
        area.set({ filters: { ...filters, freeOnly: false, datasets: [], fromYear: null, toYear: null }, scenes: ready([scene()]) });
        await updated(element);

        expect(text).toContain("USGS found no scene over the city's area.");
        expect(area1).toBe('#/settings/area');
        expect(calls(area)).toEqual([
            'setFilters {"fromYear":null,"toYear":null}',
            'setFilters {"datasets":[]}',
            'setFilters {"freeOnly":false}',
        ]);
        // Nothing the filters keep: the same guidance, with only the link left to offer.
        expect(deepText(deep(element, '[data-state="zero-results"]'))).toContain('No scene matches the filters.');
        expect(deepAll(element, '[data-state="zero-results"] hcm-button')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        ['apiError.usgs.credentials', 'link'],
        ['apiError.usgs.accessPending', 'link'],
        ['apiError.usgs.unavailable', 'retry'],
        ['apiError.usgs.maintenance', 'retry'],
        ['apiError.rateLimited', 'retry'],
        ['apiError.usgs.notConfigured', 'link'],
        ['apiError.internal', 'none'],
    ] as const)('badPath_aFailedSearch_%s_offers_%s', async (key, cure) => {
        const search = { phase: 'failed', found: null, added: null, failedDatasets: [], error: { key } } as const;
        const { element, area } = await imageryPage(imageryState({ search }));
        const alert = deep(element, '[data-state="search-error"]');
        const offered = {
            link: deepAll(alert, 'a').map((link) => link.getAttribute('href')),
            retry: deepAll(alert, 'hcm-button').length,
        };
        if (cure === 'retry') {
            click(deep(alert, 'hcm-button'));
        }

        const expected = { link: { link: ['#/setup/usgs'], retry: 0 }, retry: { link: [], retry: 1 }, none: { link: [], retry: 0 } };
        expect(offered).toEqual(expected[cure]);
        expect(calls(area)).toEqual(cure === 'retry' ? ['search'] : []);
    });
});
