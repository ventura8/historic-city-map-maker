import { JOB_MAX_ATTEMPTS } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import {
    button,
    click,
    defineImagery,
    nth,
    imageryPage,
    imageryState,
    jobView,
    scene,
    sceneButtons,
    versionItem,
    versionPage,
    versionView,
} from './fixtures.js';

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

const SCENE = { kind: 'scene' as const, id: 'DS1035-1057DA023' };
const VERSION = { kind: 'version' as const, id: 'job-1966' };

async function confirm(element: HTMLElement): Promise<void> {
    await updated(element);
    click(deep(deep(element, 'hcm-confirm-dialog'), '.confirm'));
    await updated(element);
}

describe('<hcm-imagery-page>: a scene', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_itsBrowseImageWhatUsgsSaysEveryReasonAndImportOpensItsVersion', async () => {
        const { element, area, app } = await imageryPage(imageryState({ detail: SCENE }), { params: ['scene', SCENE.id] });

        expect(deep(element, 'img.browse').getAttribute('alt')).toBe('The USGS preview of scene DS1035-1057DA023');
        expect(deepAll(element, '.reasons li').map((reason) => reason.textContent.trim())).toEqual([
            'Free: the frame is already scanned',
            'Covers 94% of the city',
            '1966 is one of the years the city wants',
            'Detail of about 2.8 m',
        ]);
        expect(deepText(element)).toContain('Corona (Declass 1)');
        expect(deepText(element)).toContain('12 %');
        click(button(element, 'Import (free)'));
        await updated(element);

        expect(calls(area)).toEqual(['importScene "DS1035-1057DA023"']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","job-new"]}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRefusedImportSaysWhyAndAnImportingSceneWaits', async () => {
        const state = imageryState({
            detail: SCENE,
            importing: SCENE.id,
            importRefusal: { id: SCENE.id, notice: { key: 'apiError.imagery.dailyLimit', params: { limit: '10' } } },
        });
        const { element, app } = await imageryPage(state, { params: ['scene', SCENE.id] }, { importScene: Promise.resolve(null) });

        expect((button(element, 'Importing…') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect(deep(element, '.pane[data-scene] .alert').textContent).toContain('10');
        expect(app.named('navigate')).toEqual([]);
    });

    it('badPath_aSceneToOrderOneImportedAndDownloadsNotApprovedOfferNoImport', async () => {
        const toOrder = scene({ free: false });
        const imported = scene({ id: 'DS3', status: 'imported', layerId: 'kh-4a-1966' });
        const { element, area } = await imageryPage(
            imageryState({ detail: SCENE, visible: [toOrder], scenes: { ...imageryState().scenes, items: [toOrder] } }),
        );
        const order = deep(element, '[data-state="needs-order"]').textContent;
        area.set({ detail: { kind: 'scene', id: 'DS3' }, scenes: { ...imageryState().scenes, items: [imported] } });
        await updated(element);
        const version = deep(element, '.pane[data-scene] a').getAttribute('href');
        area.set({ versions: { ...imageryState().versions, items: [] } });
        await updated(element);
        const layer = deep(element, '.pane[data-scene] a').getAttribute('href');
        area.set({ detail: SCENE, usgs: 'pending', scenes: { ...imageryState().scenes, items: [scene()] } });
        await updated(element);

        // M4: the scene to buy has its order card (packages/ui/test/admin/imagery/orders.test.ts has the rest).
        expect(order).toContain('Must be ordered from USGS');
        expect([version, layer]).toEqual(['#/imagery/version/job-1966', '#/layers/kh-4a-1966']);
        // Downloads not approved yet: Import is there but off, with why and the way to Setup (S-A11-BAD-DOWNLOAD-NOT-APPROVED).
        const pending = deep(element, '.pane[data-scene] [data-state="downloads-pending"]');
        expect(pending.getAttribute('role')).toBe('alert');
        expect(pending.textContent).toContain('USGS has not approved M2M access for this account yet.');
        expect(deep(pending, 'a').getAttribute('href')).toBe('#/setup/usgs');
        const imports = sceneButtons(element) as (HTMLElement & { disabled: boolean })[];
        expect(imports.map((target) => target.disabled)).toEqual([true]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aBrowseImageLoadingOrUnavailableWithTryAgain', async () => {
        const { element, area } = await imageryPage(imageryState({ detail: SCENE, browse: {} }), { params: ['scene', SCENE.id] });
        const loading = deepText(element);
        area.set({ browse: { [SCENE.id]: { status: 'failed', error: { key: 'apiError.imagery.browseUnavailable' } } } });
        await updated(element);
        click(button(element, 'Try again'));

        expect(loading).toContain('Loading the preview…');
        expect(deep(element, '[data-state="browse-unavailable"]').getAttribute('role')).toBe('alert');
        expect(calls(area)).toEqual(['retryBrowse "DS1035-1057DA023"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aPreviewThatCouldNotBeMadeSaysSoInsteadOfShowingTheRowsCrop @S-A11-BAD-PREVIEW-UNAVAILABLE', async () => {
        const error = { key: 'apiError.imagery.browseUnavailable' } as const;
        const browse = { [SCENE.id]: { status: 'ready' as const, url: 'blob:thumb', preview: null, error } };
        const { element, area } = await imageryPage(imageryState({ detail: SCENE, browse }), { params: ['scene', SCENE.id] });

        click(button(element, 'Try again'));

        expect(deep(element, '[data-state="browse-unavailable"]').getAttribute('role')).toBe('alert');
        expect(element.shadowRoot?.querySelector('img.browse')).toBeNull();
        expect(calls(area)).toEqual(['retryBrowse "DS1035-1057DA023"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aSceneNotInTheListIsNotFoundOnceTheListIsRead', async () => {
        const { element, area } = await imageryPage(
            imageryState({ detail: { kind: 'scene', id: 'gone' }, scenes: { ...imageryState().scenes, status: 'loading' } }),
        );
        const loading = deepAll(element, '[slot="detail"] hcm-loading-indicator').length;
        area.set({ scenes: imageryState().scenes });
        await updated(element);

        expect(loading).toBe(1);
        expect(deep(element, '[data-detail-heading]').textContent).toBe('No scene has this address');
        expect(deep(element, '[slot="detail"] .pane a').getAttribute('href')).toBe('#/imagery');
    });
    it('happyPath_anUnknownCloudCoverAnImportedSceneWithoutItsLayerAndAnImportThatOpensNothing', async () => {
        const unknown = scene({ cloudCover: null });
        const state = imageryState({ detail: SCENE, scenes: { ...imageryState().scenes, items: [unknown] }, visible: [unknown] });
        const { element, area, app } = await imageryPage(state, { params: ['scene', SCENE.id] }, { importScene: Promise.resolve(null) });
        const cloud = deepText(element);
        click(button(element, 'Import (free)'));
        await updated(element);
        const lost = scene({ status: 'imported', layerId: null });
        area.set({ scenes: { ...imageryState().scenes, items: [lost] }, versions: { ...imageryState().versions, items: [] } });
        await updated(element);

        expect(cloud).toContain('not recorded');
        expect(app.named('navigate')).toEqual([]);
        expect(deep(element, '.pane[data-scene] a').getAttribute('href')).toBe('#/layers/');
    });
});

describe('<hcm-imagery-page>: an imported scene', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_anImportedFreeSceneOffersImportAgainWhichOpensTheNewVersion @S-A12-HAPPY-IMPORT-AGAIN', async () => {
        const imported = scene({ status: 'imported', layerId: 'kh-7-1966' });
        const state = imageryState({ detail: SCENE, scenes: { ...imageryState().scenes, items: [imported] }, visible: [imported] });
        const { element, area, app } = await imageryPage(state, { params: ['scene', SCENE.id] });

        click(button(element, 'Import again (free)'));
        await updated(element);

        expect(calls(area)).toEqual([`importScene "${SCENE.id}" true`]);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","job-new"]}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anImportedSceneToOrderOrWithoutDownloadsOffersNoImportAgain @S-A12-BAD-IMPORT-AGAIN-MOVED', async () => {
        const toOrder = scene({ status: 'imported', layerId: 'kh-7-1966', free: false });
        const state = imageryState({ detail: SCENE, scenes: { ...imageryState().scenes, items: [toOrder] }, visible: [toOrder] });
        const { element, area } = await imageryPage(state, { params: ['scene', SCENE.id] });
        const offered = deepText(element).includes('Import again');
        area.set({ usgs: 'pending', scenes: { ...imageryState().scenes, items: [scene({ status: 'imported', layerId: 'kh-7-1966' })] } });
        await updated(element);

        expect([offered, deepText(element).includes('Import again')]).toEqual([false, false]);
    });
});

describe('<hcm-imagery-page>: a version', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theApprovalCardUnderTheThresholdWithItsCostAndApprove', async () => {
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage() }), {
            params: ['version', 'job-1966'],
        });

        expect(deep(element, '[data-detail-heading]').textContent).toBe('KH-4A Corona, 12 July 1966 · A023');
        expect(deep(element, '[data-rmse="under"]').textContent).toContain("7.2 m, under the city's threshold (15 m)");
        expect(deep(element, '[data-estimate]').textContent).toContain('about 2.5 Mapbox compute units; 16 are left');
        expect(deepText(element)).toContain('Pairs of points: 24; checks: 24.');
        expect(deepAll(element, '.steps li').map((step) => step.getAttribute('data-state'))).toEqual(['done', 'done', 'running']);
        expect(deepAll(element, '.log li')[0]?.textContent).toContain('rendered <b>ok</b>');
        expect(deepAll(element, 'b')).toHaveLength(0);
        click(button(element, 'Approve and publish'));
        expect(calls(area)).toEqual(['approve']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_rejectAndCancelAskFirst', async () => {
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage() }));

        click(button(element, 'Delete'));
        await confirm(element);
        click(button(element, 'Cancel'));
        await updated(element);
        click(deep(deep(element, 'hcm-confirm-dialog'), '.cancel'));
        await updated(element);

        expect(calls(area)).toEqual(['reject']);
        expect((deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean }).open).toBe(false);
    });

    it('badPath_overTheThresholdOrUnmeasuredTheCardWarns', async () => {
        const over = versionView({
            georef: {
                ...{ method: 'auto', transform: 'affine', pairs: 6 },
                ...{ fitRmseM: 20, checkpointRmseM: 31.5, checkpointCount: null, checkpointKind: null },
            },
        });
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, over) }));
        const warned = deep(element, '[data-rmse="over"]').textContent;
        area.set({ version: versionPage({}, versionView({ georef: null, estimate: null })) });
        await updated(element);

        expect(warned).toContain('31.5 m is over');
        expect(deep(element, '[data-rmse="unmeasured"]')).toBeDefined();
        expect(deep(element, '[data-estimate]').textContent).toContain('about 0 Mapbox');
    });

    it('happyPath_overBudgetTheThreeWaysOutAndPayAsksFirst', async () => {
        const guard = { verdict: 'over' as const, available: 1.5, overageUsd: 3.75, choice: null, deferUntil: null };
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, versionView({ guard })) }));

        expect(deep(element, '[data-state="over-budget"]').textContent).toContain('1.5 compute units left');
        click(button(element, 'Free: upload the file in Mapbox Studio'));
        click(nth(element, '.choices hcm-button', 1));
        click(button(element, 'Publish now, at a cost of about 3.75 USD'));
        await confirm(element);

        expect(calls(area)).toEqual(['choose "studio"', 'choose "defer"', 'choose "pay"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anApprovedVersionTheGuardStoppedStillOffersTheThreeWaysOut', async () => {
        // The policy approved it (CR-M3-33); the month's compute units did not let it through.
        const guard = { verdict: 'over' as const, available: 0.5, overageUsd: 2, choice: null, deferUntil: null };
        const approved = versionView({ state: 'approved', guard });
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, approved) }));

        expect(deep(element, '[data-state="over-budget"]').textContent).toContain('0.5 compute units left');
        click(button(element, 'Free: upload the file in Mapbox Studio'));
        area.set({ version: versionPage({}, versionView({ state: 'approved', guard: { ...guard, verdict: 'within' } })) });
        await updated(element);

        expect(calls(area)).toEqual(['choose "studio"']);
        expect(deepAll(element, '[data-state="over-budget"], .card')).toHaveLength(0);
    });

    it('badPath_pastTheTilesetCapThereIsNeitherPaymentNorWaiting', async () => {
        const guard = { verdict: 'tileset-limit' as const, available: 10, overageUsd: null, choice: null, deferUntil: null };
        const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, versionView({ guard })) }));

        const card = deep(element, '[data-state="tileset-limit"]');
        expect(card.textContent).toContain('The Mapbox account is full (24 tilesets). Delete a layer, or use Studio.');
        expect(deep(card, 'a[href="#/layers"]').textContent).toBe('Open Layers');
        expect(deepAll(element, '.choices hcm-button').map((choice) => choice.textContent.trim())).toEqual([
            'Free: upload the file in Mapbox Studio',
        ]);
    });

    it('badPath_aFileTooLargeForMapboxOffersOnlyTheFreeStudioUpload', async () => {
        const guard = { verdict: 'too-large' as const, available: 20, overageUsd: null, choice: null, deferUntil: null };
        const { element, area } = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({}, versionView({ state: 'approved', guard })) }),
        );

        expect(deep(element, '[data-state="too-large"]').textContent).toContain('Mapbox refused the 212 MB file: too large.');
        click(button(element, 'Free: upload the file in Mapbox Studio'));

        expect(deepAll(element, '.choices hcm-button')).toHaveLength(1);
        expect(calls(area)).toEqual(['choose "studio"']);
    });

    it('happyPath_thePayQuestionWritesTheAmountAsTheButtonDoes', async () => {
        const guard = { verdict: 'over' as const, available: 0.5, overageUsd: 20.25, choice: null, deferUntil: null };
        const { element } = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({}, versionView({ state: 'approved', guard })) }),
            { locale: 'ro' },
        );

        click(button(element, 'Publică acum, cu un cost de circa 20,25 USD'));
        await updated(element);

        expect(deep(element, 'hcm-confirm-dialog').getAttribute('open')).not.toBeNull();
        expect((deep(element, 'hcm-confirm-dialog') as HTMLElement & { body: string }).body).toBe(
            'Mapbox facturează luna aceasta circa 20,25 USD peste planul gratuit.',
        );
    });

    it('happyPath_theStudioStepsAndADeferredPublish', async () => {
        const studio = { verdict: 'over' as const, available: 0, overageUsd: 4, choice: 'studio' as const, deferUntil: null };
        const { element, area } = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({ downloaded: true }, versionView({ guard: studio })) }),
        );

        click(button(element, '1. Download the file'));
        click(button(element, '3. I uploaded it'));
        const link = deep(element, '[data-state="studio-steps"] a').getAttribute('href');
        const done = deepAll(element, '[data-state="studio-steps"] hcm-icon[name="check_circle"]').length;
        area.set({
            version: versionPage({}, versionView({ guard: { ...studio, choice: 'defer', deferUntil: '2026-11-01T00:00:00.000Z' } })),
        });
        await updated(element);

        expect(calls(area)).toEqual(['download', 'studioDone']);
        expect([link, done]).toEqual(['https://studio.mapbox.com/tilesets/', 1]);
        expect(deep(element, '[data-state="deferred"]').textContent).toContain('Publishes on Nov 1, 2026');
    });
});

/** M5 (`docs/research/M5-interfaces.md` §1.8): the city's own share of the month's compute units. */
describe('<hcm-imagery-page>: a version over the city’s share', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('badPath_overTheCitysShareStudioOrNextMonthButNoPayment @S-A52-BAD-CITY-SHARE', async () => {
        // M5: paying the project's overage would not raise the city's share of the month.
        const guard = { verdict: 'city-over' as const, available: 0.5, overageUsd: 0, choice: null, deferUntil: null };
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, versionView({ guard })) }));

        expect(deep(element, '[data-state="city-over"]').textContent).toContain('the city has 0.5 left this month');
        click(nth(element, '.choices hcm-button', 1));

        expect(deepAll(element, '.choices hcm-button')).toHaveLength(2);
        expect(deepAll(element, '.choices hcm-button').some((choice) => choice.textContent.includes('USD'))).toBe(false);
        expect(calls(area)).toEqual(['choose "defer"']);
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-imagery-page>: a job and an upload', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('badPath_aFailedJobWithTryAgainTheGeoreferencerAndTheRedactedDetail', async () => {
        const failed = jobView({
            status: 'failed',
            finished: true,
            attempt: 1,
            retryable: true,
            error: { notice: { key: 'apiError.imagery.noMatch', params: { pairs: '3' } }, message: 'matched 3 pairs' },
        });
        const { element, area } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage(
                    { refusal: { key: 'apiError.imagery.versionState' } },
                    versionView({ state: 'needs_gcps', output: null }),
                    failed,
                ),
            }),
        );

        click(button(element, 'Try again'));

        expect(deep(element, '[data-state="failed"]').textContent).toContain('matched 3 pairs');
        expect(deep(element, 'a[href="#/georef/job-1966"]')).toBeDefined();
        expect(deepAll(element, '.slider-row')).toHaveLength(0);
        expect(deepAll(element, '.pane .alert').length).toBeGreaterThan(1);
        expect(calls(area)).toEqual(['retryJob']);
        expect((await axeViolations(element)).join('\n')).toBe('');
    });

    it('happyPath_aUsgsFrameWaitingForPointsOffersLocateAgain @S-A69-HAPPY-LOCATE-AGAIN', async () => {
        const waiting = jobView({ status: 'awaiting_gcps', waitReason: 'gcps', finished: false });
        const { element, area } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage({}, versionView({ state: 'needs_gcps', origin: 'usgs', output: null }), waiting),
            }),
        );

        click(button(element, 'Locate again'));

        expect(calls(area)).toEqual(['locateAgain']);
        expect(deepAll(element, '.actions hcm-button').map((found) => found.textContent.trim())).not.toContain('Try again');
        expect((await axeViolations(element)).join('\n')).toBe('');
    });

    // M18 item 3: a frame whose crop failed is offered Locate again before a new import; a later failure is not.
    function failedAt(step: string, attempt = 1) {
        const failed = jobView({
            status: 'failed',
            finished: true,
            retryable: false,
            attempt,
            steps: [{ name: step, status: 'failed', transfer: null }],
        });
        return imageryState({
            detail: VERSION,
            version: versionPage({}, versionView({ state: 'failed', origin: 'usgs', output: null }), failed),
        });
    }

    it.each(['locate', 'stitch'])('happyPath_aCropThatFailedAt_%s_offersLocateAgain @S-A69-HAPPY-FAILED-CROP', async (step) => {
        const { element, area } = await imageryPage(failedAt(step));

        click(button(element, 'Locate again'));

        expect(calls(area)).toEqual(['locateAgain']);
    });

    // Review of M18 item 3: a crop that fails each time stops at the attempts' limit, as Retry does.
    it('badPath_aCropThatFailedWithNoRunsLeftOffersNoLocateAgain', async () => {
        const { element } = await imageryPage(failedAt('stitch', JOB_MAX_ATTEMPTS));

        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Locate again'))).toBe(false);
    });

    it('badPath_aFailureAfterTheCropOffersNoLocateAgain @S-A69-BAD-FAILED-LATER', async () => {
        const { element } = await imageryPage(failedAt('georef'));

        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Locate again'))).toBe(false);
    });

    it.each([
        ['an upload', versionView({ state: 'needs_gcps', origin: 'upload', output: null }), 'awaiting_gcps'],
        ['a version not waiting', versionView({ state: 'processing', origin: 'usgs', output: null }), 'awaiting_gcps'],
        ['a job that moved on', versionView({ state: 'needs_gcps', origin: 'usgs', output: null }), 'queued'],
    ] as const)('badPath_noLocateAgainFor_%s @S-A69-BAD-NOT-WAITING', async (_name, version, status) => {
        const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, version, jobView({ status })) }));

        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Locate again'))).toBe(false);
    });

    it('happyPath_aPublishedVersionLinksItsLayerAndThePreviewsOpacityMoves', async () => {
        const done = jobView({ status: 'succeeded', finished: true, waitReason: null });
        const { element, area } = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({}, versionView({ state: 'published' }), done) }),
        );

        const slider = deep(element, '.slider-row hcm-slider');
        slider.dispatchEvent(new CustomEvent('hcm-input', { detail: { value: 35 } }));

        expect(deep(element, 'a[href="#/layers/kh-4a-1966"]').textContent).toBe('Open the published layer');
        expect(deepAll(element, '[slot="detail"] .pane > .actions hcm-button')).toHaveLength(0);
        expect(calls(area)).toEqual(['setPreviewOpacity 35']);
    });

    it('happyPath_aRunningJobsProgressWaitAndStoppingButton', async () => {
        const running = jobView({ status: 'waiting_usgs', waitReason: 'usgs-preparing', progress: null, cancelRequested: true });
        const { element, area } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage(
                    { logs: { ...versionPage().logs, items: [] } },
                    versionView({ state: 'processing', output: null }),
                    running,
                ),
            }),
        );
        const stopping = button(element, 'Stopping…') as HTMLElement & { disabled: boolean };
        const preparing = deep(element, '[data-wait="usgs-preparing"]').textContent;
        area.set({
            version: versionPage(
                {},
                versionView({ state: 'processing' }),
                jobView({ status: 'mts_processing', waitReason: 'mapbox', progress: 0.9, atMapbox: true }),
            ),
        });
        await updated(element);

        expect([stopping.disabled, preparing]).toEqual([true, 'USGS is preparing the download']);
        expect(deepText(element)).toContain('Mapbox is preparing the tiles');
        expect(deepAll(element, '[slot="detail"] .pane hcm-button').some((candidate) => candidate.textContent.includes('Cancel'))).toBe(
            false,
        );
    });
});

describe('<hcm-imagery-page>: a running download', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theDownloadsStepLineShowsItsBytesOfTheTotalThenItsBytesAlone', async () => {
        const fetching = (transfer: { received: number; total: number | null }) =>
            versionPage(
                {},
                versionView({ state: 'processing', output: null }),
                jobView({
                    status: 'running',
                    waitReason: null,
                    progress: 0.09,
                    step: 'fetch',
                    steps: [
                        { name: 'fetch', status: 'running', transfer },
                        { name: 'extract', status: 'pending', transfer: null },
                    ],
                }),
            );
        const { element, area } = await imageryPage(
            imageryState({ detail: VERSION, version: fetching({ received: 1_234_000_000, total: 3_400_000_000 }) }),
        );
        const line = (): string => deep(element, '.steps li[data-state="running"]').textContent.replace(/\s+/g, ' ').trim();
        const known = line();
        area.set({ version: fetching({ received: 524_000_000, total: null }) });
        await updated(element);

        expect(known).toBe('Downloading the scene Running · 1.23 of 3.4 GB');
        expect(line()).toBe('Downloading the scene Running · 0.52 GB');
    });
});

describe('<hcm-imagery-page>: an upload and its version', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('badPath_anUploadBeingCheckedNotFoundLoadingAndAFailedRead', async () => {
        const { element, area } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage({ version: { status: 'ready', doc: null, reconnecting: false, failure: null } }),
            }),
        );
        const checking = deep(element, '[data-detail-heading]').textContent;
        area.set({
            version: versionPage({
                version: { status: 'ready', doc: null, reconnecting: false, failure: null },
                job: { status: 'ready', doc: null, reconnecting: false, failure: null },
            }),
        });
        await updated(element);
        const missing = deep(element, '[data-detail-heading]').textContent;
        area.set({ version: null });
        await updated(element);
        const loading = deepAll(element, '[slot="detail"] hcm-loading-indicator').length;
        area.set({
            version: versionPage({
                version: { status: 'error', doc: null, reconnecting: false, failure: { kind: 'failed', code: 'internal' } },
            }),
        });
        await updated(element);
        click(button(element, 'Try again'));

        expect([checking, missing, loading]).toEqual(['The uploaded file', 'No such version', 1]);
        expect(calls(area)).toEqual(['retry']);
    });

    it('happyPath_aFinishedUploadOpensItsVersionOnce', async () => {
        const { element, app, area } = await imageryPage(imageryState({ tab: 'upload' }));
        const done = { ...imageryState().upload, phase: 'done' as const, jobId: 'up1', fileName: 'scan.tif' };

        area.set({ upload: done });
        await updated(element);
        area.set({ upload: { ...done } });
        await updated(element);

        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","up1"]}']);
        expect(versionItem().id).toBe('job-1966');
    });
    // M18 item 5 (docs/research/M18-improvements.md): one Delete and one question for an image at every stage.
    it('happyPath_aFrameWaitingForPointsIsDeletedWithTheSameWordsAsEveryStage @S-A33-HAPPY-ONE-DELETE', async () => {
        const waiting = jobView({ status: 'awaiting_gcps', waitReason: 'gcps', finished: false });
        const { element, area } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage({}, versionView({ state: 'needs_gcps', origin: 'usgs', output: null }), waiting),
            }),
        );

        click(button(element, 'Delete'));
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; confirmLabel: string };
        expect([dialog.headline, dialog.confirmLabel]).toEqual(['Delete this image?', 'Delete']);
        await confirm(element);

        // Review of M18 item 5: deleted by imagery.reject as at every stage, so the version then reads Deleted, not Cancelled.
        expect(calls(area)).toEqual(['reject']);
        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Cancel job'))).toBe(false);
    });

    it('happyPath_waitingForApprovalAndStoppedAtTheGuardTheSameDeleteAndQuestion @S-A33-HAPPY-ONE-DELETE', async () => {
        const guard = { verdict: 'over' as const, available: 0.5, overageUsd: 2, choice: null, deferUntil: null };
        const { element, area } = await imageryPage(imageryState({ detail: VERSION, version: versionPage() }));
        const asked = async (): Promise<readonly string[]> => {
            click(button(element, 'Delete'));
            await updated(element);
            const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; confirmLabel: string };
            const words = [dialog.headline, dialog.confirmLabel];
            await confirm(element);
            return words;
        };

        const waiting = await asked();
        area.set({ version: versionPage({}, versionView({ state: 'approved', guard })) });
        await updated(element);
        const atTheGuard = await asked();

        expect([waiting, atTheGuard]).toEqual([
            ['Delete this image?', 'Delete'],
            ['Delete this image?', 'Delete'],
        ]);
        expect(calls(area)).toEqual(['reject', 'reject']);
    });

    it('happyPath_cancellingAJobAsksFirstAndTheBackAndTheZoomPassOn', async () => {
        const { element, area, app } = await imageryPage(imageryState({ detail: VERSION, version: versionPage() }), { width: 400 });
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean };
        const stop = button(element, 'Cancel job');

        click(stop);
        await updated(element);
        const asked = dialog.open;
        dialog.dispatchEvent(new CustomEvent('hcm-confirm'));
        await updated(element);
        click(stop);
        await updated(element);
        dialog.dispatchEvent(new CustomEvent('hcm-cancel'));
        await updated(element);
        deep(element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: 1 } }));
        deep(element, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));

        expect([asked, dialog.open]).toEqual([true, false]);
        expect(calls(area)).toEqual(['cancelJob', 'zoomBy 1']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":[]}']);
    });
});

describe('<hcm-imagery-page>: an archive series waiting for points (M22)', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    // M22: an archive series waiting for points places itself again (and makes its picture for the georeferencer); a failed one does not.
    it('happyPath_anArchiveSeriesWaitingForPointsOffersLocateAgain @S-A122-HAPPY-PLACE-AGAIN', async () => {
        const waiting = jobView({ status: 'awaiting_gcps', waitReason: 'gcps', finished: false });
        const { element, area } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage({}, versionView({ state: 'needs_gcps', origin: 'archive', output: null }), waiting),
            }),
        );

        click(button(element, 'Locate again'));

        expect(calls(area)).toEqual(['locateAgain']);
    });

    it('badPath_aFailedArchiveSeriesOffersNoLocateAgain @S-A122-BAD-PLACE-AGAIN-CANCELLED', async () => {
        const failed = jobView({
            status: 'failed',
            finished: true,
            retryable: false,
            steps: [{ name: 'place', status: 'failed', transfer: null }],
        });
        const { element } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage({}, versionView({ state: 'failed', origin: 'archive', output: null }), failed),
            }),
        );

        expect(deepAll(element, '.actions hcm-button').map((found) => found.textContent.trim())).not.toContain('Locate again');
    });
});
