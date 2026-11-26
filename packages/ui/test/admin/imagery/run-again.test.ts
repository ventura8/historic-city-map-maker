/**
 * Lesson 728 (the owner's request of 2026-11-14): **Run again with the latest pipeline** on a version that waits for approval, was
 * cancelled or failed, and **Imported: run again** on Find's card of an imported scene, whose tag says its version's state. Also the
 * search's line: the usual length, the minutes so far, and a source waiting its turn.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import {
    click,
    defineImagery,
    imageryPage,
    imageryState,
    jobView,
    ready,
    scene,
    versionItem,
    versionPage,
    versionView,
} from './fixtures.js';

const L1991 = 'LT51820291991181XXX03';
const VERSION = { kind: 'version' as const, id: 'job-1966' };

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => call.startsWith('importScene'));
}

function onVersion(overrides: Partial<VersionViewPort>, more: Partial<ImageryViewState> = {}) {
    const view = versionView({ entityId: L1991, ...overrides });
    const job = jobView({ status: 'cancelled', finished: true });
    return imageryPage(imageryState({ detail: VERSION, version: versionPage({}, view, job), ...more }), {
        params: ['version', 'job-1966'],
    });
}

describe('<hcm-imagery-page>: Run again with the latest pipeline', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it.each(['awaiting_approval', 'cancelled', 'failed'] as const)(
        'happyPath_aUsgsVersionThatIs_%s_RunsAgainAndOpensTheNewVersion @S-A130-HAPPY-RUN-AGAIN',
        async (state) => {
            const { element, area, app } = await onVersion({ state });

            click(deep(element, '.run-again hcm-button'));
            await updated(element);

            expect(calls(area)).toEqual([`importScene "${L1991}" true`]);
            expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","job-new"]}']);
            expect(deep(element, '.run-again').textContent).toContain('Run again with the latest pipeline');
            expect(await axeViolations(deep(element, '.run-again'))).toEqual([]);
        },
    );

    it('badPath_aRunningUploadOrDownloadsPendingVersionOffersNoRunAgain_andARefusalSaysWhy @S-A130-BAD-RUN-AGAIN', async () => {
        const { element: running } = await onVersion({ state: 'processing' });
        const processing = deepAll(running, '.run-again').length;
        cleanup();
        const { element: upload } = await onVersion({ state: 'failed', origin: 'upload', entityId: null });
        const uploaded = deepAll(upload, '.run-again').length;
        cleanup();
        const { element: pending } = await onVersion({ state: 'failed' }, { usgs: 'pending' });
        const notApproved = deepAll(pending, '.run-again').length;
        cleanup();
        const refusal = { id: L1991, notice: { key: 'apiError.usgs.accessPending' as const } };
        const { element, area } = await onVersion({ state: 'failed' }, { importRefusal: refusal, importing: null });
        const shown = deep(element, '[data-state="run-again-refused"]').textContent;
        area.set({ importing: L1991 });
        await updated(element);

        expect([processing, uploaded, notApproved]).toEqual([0, 0, 0]);
        expect(shown).toContain('USGS');
        expect(deep(element, '.run-again hcm-button').textContent).toContain('Importing');
    });
});

describe('<hcm-imagery-page>: Find lists imported scenes', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_anImportedSceneSaysItsVersionsStateAndRunsAgainFromItsCard @S-A130-HAPPY-FIND-IMPORTED', async () => {
        const waiting = scene({ id: L1991, displayId: L1991, status: 'imported', layerId: 'kh-4a-1966' });
        const done = scene({ id: 'LT5-2008', displayId: 'LT5-2008', status: 'imported', layerId: 'landsat-2008' });
        const state = imageryState({ scenes: ready([waiting, done]), visible: [waiting, done] });
        const { element, area } = await imageryPage(state);

        const tags = deepAll(element, '[data-imported]').map((tag) => tag.textContent.trim());
        click(deep(element, `li[data-scene="${L1991}"] [data-run-again]`));
        await updated(element);

        expect(tags).toEqual(['Imported · Awaiting approval', 'Imported']);
        expect(calls(area)).toEqual([`importScene "${L1991}" true`]);
        expect(deepText(element)).toContain('Imported: run again');
    });

    it('badPath_anImportedSceneWhoseVersionStillRunsOffersNoRunAgain @S-A130-BAD-FIND-IMPORTED', async () => {
        const running = scene({ status: 'imported', layerId: 'kh-4a-1980' });
        const versions = ready([versionItem({ id: 'job-1980', layerId: 'kh-4a-1980', state: 'processing', needsYou: false })]);
        const { element } = await imageryPage(imageryState({ scenes: ready([running]), visible: [running], versions }));

        expect(deepAll(element, '[data-run-again]')).toHaveLength(0);
        expect(deep(element, '[data-imported]').getAttribute('data-imported')).toBe('processing');
    });
});

describe('<hcm-imagery-page>: the search says how long it takes', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aRunningSearchSaysTheUsualLengthThenTheMinutesSoFar @S-A11-HAPPY-SEARCH-ELAPSED', async () => {
        const searching = { phase: 'searching', found: null, added: null, failedDatasets: [], error: null } as const;
        const parts = [
            { dataset: 'corona2', state: 'searching', found: 0 },
            { dataset: 'landsat_tm_c2_l1', state: 'queued', found: 0 },
        ] as const;
        const { element, area } = await imageryPage(imageryState({ search: { ...searching, datasets: parts } }));
        const first = deep(element, '[role="status"]').textContent;
        const queued = deep(element, '[data-part="queued"]').textContent;
        area.set({ search: { ...searching, elapsedS: 185 } });
        await updated(element);

        expect(first).toContain('usually takes up to 7 minutes');
        expect(queued).toContain('waiting its turn');
        expect(deep(element, '[role="status"]').textContent).toContain('3 min so far');
    });

    it('badPath_underAMinuteSaysOnlyTheUsualLength @S-A11-BAD-SEARCH-ELAPSED', async () => {
        const search = { phase: 'searching', found: null, added: null, failedDatasets: [], error: null, elapsedS: 30 } as const;
        const { element } = await imageryPage(imageryState({ search }));

        expect(deep(element, '[role="status"]').textContent).not.toContain('so far');
    });
});
