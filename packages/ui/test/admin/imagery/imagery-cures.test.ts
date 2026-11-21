/**
 * What a failure, a pause or a refusal offers the admin (CR-M3-47; `docs/research/M3-interfaces.md` §10.2): the budget
 * guard's banner with the spend and Resume processing (asked first) on the Imagery and Jobs pages, a version page's cure
 * for each failure (Try again only when a retry can help, Setup's Mapbox step for a token or scope, Upload another file
 * for an upload the server refused, Delete this version for a failed one), Cancel before Mapbox is asked, the search's Try again
 * when USGS did not answer, and the georeferencer's keyboard way (the pair button toggles, Esc lets a pair go).
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { JobsIntentsPort, JobsViewState } from '../../../src/admin/jobs/jobs-port.js';
import type { ImageryIntentsPort, ImageryViewState } from '../../../src/admin/imagery/imagery-port.js';
import { moneyText } from '../../../src/admin/imagery/guard-banner.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { jobsState, page } from '../ops/fixtures.js';
import {
    button,
    click,
    defineImagery,
    georefPage,
    georefState,
    imageryPage,
    imageryState,
    jobView,
    versionPage,
    versionView,
} from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const PAUSED = { paused: true, costAmount: 5.37, budgetAmount: 5, currency: 'USD' };

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

async function confirm(element: HTMLElement): Promise<void> {
    await updated(element);
    click(deep(deep(element, 'hcm-confirm-dialog'), '.confirm'));
    await updated(element);
}

describe('the budget guard on the Imagery page', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aPauseShowsTheSpendAndResumeAsksFirst', async () => {
        const { element, area } = await imageryPage(imageryState({ guard: PAUSED }), {}, { resumeGuard: Promise.resolve(true) });

        expect(deep(element, '[data-state="guard-paused"]').textContent).toContain(
            'Processing paused: Google Cloud cost $5.37 of $5.00 this month. The public map works.',
        );
        click(button(element, 'Resume processing'));
        await confirm(element);

        expect(calls(area)).toEqual(['resumeGuard']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aGreenGuardOrOneStillReadingShowsNothingAndAResumeOnItsWayWaits', async () => {
        const { element, area } = await imageryPage(imageryState({ guard: { ...PAUSED, paused: false } }));
        expect(deepAll(element, '[data-state="guard-paused"]')).toHaveLength(0);

        area.set({ guard: null });
        await updated(element);
        expect(deepAll(element, '[data-state="guard-paused"]')).toHaveLength(0);

        area.set({ guard: { paused: true, costAmount: null, budgetAmount: null, currency: null }, resuming: true });
        await updated(element);
        expect(deep(element, '[data-state="guard-paused"]').textContent).toContain('Processing is paused: the monthly budget was reached.');
        expect((button(element, 'Resume processing') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('happyPath_amountsInTheAdminsLanguageAndTheAlertsCurrency', () => {
        expect(moneyText('ro', 5.37, 'USD')).toBe('5,37\u00a0USD');
        expect(moneyText('en', 5.37, 'EUR')).toBe('€5.37');
        expect(moneyText('ro', 5.5, null)).toBe('5,5');
    });
});

describe('the budget guard on the Jobs page', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_thePauseAndResumeAskFirstOnTheJobsList', async () => {
        const jobs = new FakeArea<JobsViewState, JobsIntentsPort>(jobsState({ guard: PAUSED }), { resumeGuard: Promise.resolve(true) });
        const { element } = await page('jobs', jobs);

        expect(deepText(element)).toContain('cost $5.37 of $5.00 this month');
        click(button(element, 'Resume processing'));
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog[open]');
        expect(dialog).toBeDefined();
        click(deep(dialog, '.confirm'));
        await updated(element);

        expect(jobs.named('resumeGuard')).toEqual(['resumeGuard']);
    });

    it('badPath_aResumeTheAdminCancelsDoesNothing', async () => {
        const jobs = new FakeArea<JobsViewState, JobsIntentsPort>(jobsState({ guard: PAUSED }), {});
        const { element } = await page('jobs', jobs);

        click(button(element, 'Resume processing'));
        await updated(element);
        click(deep(deep(element, 'hcm-confirm-dialog[open]'), '.cancel'));
        await updated(element);

        expect(jobs.named('resumeGuard')).toEqual([]);
        expect(deepAll(element, 'hcm-confirm-dialog[open]')).toHaveLength(0);
    });
});

describe('a failed version page offers what cures it', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    function failedPage(job: Parameters<typeof jobView>[0]) {
        const failed = jobView({ status: 'failed', finished: true, waitReason: null, ...job });
        const version = versionView({ state: 'failed', output: null, error: failed.error?.notice ?? null });
        return imageryPage(imageryState({ detail: VERSION, version: versionPage({}, version, failed) }));
    }

    it('badPath_aRevokedTokenOffersSetupsMapboxStepNotTryAgain', async () => {
        const { element } = await failedPage({
            retryable: false,
            error: { notice: { key: 'apiError.mapbox.tokenInvalid' }, message: 'x' },
        });

        expect(deepAll(element, 'hcm-button').some((candidate) => candidate.textContent.trim() === 'Try again')).toBe(false);
        expect(deep(element, 'a[href="#/setup/mapbox"]').textContent).toBe('Open the Mapbox step of Setup');
    });

    it('happyPath_aFailedVersionIsDeletedAfterTheQuestion @S-A125-HAPPY-DELETE-VERSION', async () => {
        const { element, area } = await failedPage({
            retryable: false,
            error: { notice: { key: 'apiError.imagery.mtsRefused' }, message: 'x' },
        });

        click(button(element, 'Delete this version'));
        await confirm(element);

        expect(calls(area)).toEqual(['deleteVersion']);
        expect(deepAll(element, 'a[href="#/setup/mapbox"]')).toHaveLength(0);
    });

    it('badPath_anUploadTheServerRefusedOffersAnotherFile', async () => {
        const refused = jobView({
            ...{ type: 'geotiff-import', status: 'failed', finished: true, waitReason: null, refusedUpload: true },
            error: { notice: { key: 'apiError.imagery.notTiff' }, message: 'apiError.imagery.notTiff' },
        });
        const { element, area, app } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: {
                    ...versionPage({}, versionView(), refused),
                    version: { status: 'ready', doc: null, reconnecting: false, failure: null },
                },
            }),
        );

        expect(deepAll(element, 'hcm-button').some((candidate) => candidate.textContent.trim() === 'Try again')).toBe(false);
        click(button(element, 'Upload another file'));
        await updated(element);

        expect(calls(area)).toEqual(['resetUpload', 'setTab "upload"']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":[]}']);
    });

    it('happyPath_aPublishNotYetAtMapboxCanBeCancelled', async () => {
        const waiting = jobView({ status: 'mts_processing', waitReason: 'mapbox', atMapbox: false });
        const { element } = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({}, versionView({ state: 'publishing' }), waiting) }),
        );

        expect(deepAll(element, 'hcm-button').some((candidate) => candidate.textContent.trim() === 'Cancel')).toBe(true);
    });

    it('happyPath_anUploadsLabelGetsItsYearAnImportsDatedLabelDoesNot', async () => {
        const upload = versionView({ label: { ro: 'ortofoto' }, year: 1938, origin: 'upload' });
        const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, upload) }));

        expect(deep(element, '[data-detail-heading]').textContent).toBe('ortofoto · 1938 · A023');
    });
});

describe('a search USGS did not answer offers Try again', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it.each(['apiError.usgs.maintenance', 'apiError.rateLimited'] as const)('badPath_%s', async (key) => {
        const search = { phase: 'failed', found: null, added: null, failedDatasets: [], error: { key } } as const;
        const { element, area } = await imageryPage(imageryState({ search }));

        click(deep(deep(element, '[data-state="search-error"]'), 'hcm-button'));

        expect(calls(area)).toEqual(['search']);
    });
});

describe('the georeferencer by keyboard', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_thePairButtonTogglesAndEscLetsThePairGo', async () => {
        const { element, area } = await georefPage(georefState({ selected: 'g2' }));

        deep(element, 'tr[data-pair="g2"] button.pair').click();
        deep(element, 'tr[data-pair="g1"] button.pair').click();
        const canvas = deep(deep(element, 'hcm-scan-viewer'), 'canvas');
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));

        expect(area.calls.filter((call) => call.startsWith('select') || call === 'cancelHalf')).toEqual([
            'select null',
            'select "g1"',
            'cancelHalf',
        ]);
    });

    it('badPath_aScanPaneHiddenOnAPhoneKeepsAUsableCentre', async () => {
        const { element } = await georefPage(georefState({ pane: 'map' }), { width: 360, state: { windowClass: 'compact' } });
        await updated(element);

        const viewer = deep(element, 'hcm-scan-viewer') as HTMLElement & { centre: { x: number; y: number } };
        const { x, y } = viewer.centre;

        expect([Number.isFinite(x), Number.isFinite(y)]).toEqual([true, true]);
    });
});
