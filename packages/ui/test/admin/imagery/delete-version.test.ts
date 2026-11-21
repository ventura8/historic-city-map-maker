/**
 * Delete this version on the version page (S-A125-*): offered for a version that never reached the map (failed, cancelled or
 * rejected) and for an archive series waiting for points, never for a published or running one nor for one another version is
 * built on (one Delete on the page: a failed one has no Dismiss beside it); asked first with what goes and what stays, then the page
 * returns to the Historical imagery list.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { JobViewPort, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import { cleanup, deep, deepAll, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, jobView, versionItem, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const LABEL = 'Delete this version';
const ENDED = jobView({ status: 'cancelled', finished: true, waitReason: null, progress: null });
const PARKED = jobView({ status: 'awaiting_gcps', finished: false, waitReason: 'gcps' });

function shown(version: Partial<VersionViewPort>, job: JobViewPort | null) {
    return imageryState({ detail: VERSION, version: versionPage({}, versionView({ georef: null, ...version }), job) });
}

function deleteButtons(element: HTMLElement): HTMLElement[] {
    return deepAll(element, 'hcm-button').filter((candidate) => candidate.textContent.trim() === LABEL);
}

describe('<hcm-imagery-page>: Delete this version', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aCancelledVersionIsDeletedAfterTheQuestionAndThePageReturnsToTheList @S-A125-HAPPY-DELETE-VERSION', async () => {
        const { element, area, app } = await imageryPage(shown({ state: 'cancelled' }, ENDED), { params: ['version', VERSION.id] });

        click(button(element, LABEL));
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; body: string; confirmLabel: string };
        expect(dialog.headline).toBe('Delete this version for good?');
        expect(dialog.body).toContain("your computer's originals stay");
        expect(dialog.confirmLabel).toBe(LABEL);
        expect(await axeViolations(element)).toEqual([]);
        click(deep(dialog, '.confirm'));
        await updated(element);
        await Promise.resolve();
        await updated(element);

        expect(area.calls).toContain('deleteVersion');
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":[]}']);
    });

    it('happyPath_aFailedVersionOffersOnlyThisDelete @S-A125-HAPPY-DELETE-VERSION', async () => {
        const failed = jobView({ status: 'failed', finished: true, waitReason: null, progress: null });
        const { element } = await imageryPage(shown({ state: 'failed' }, failed), { params: ['version', VERSION.id] });

        expect(deleteButtons(element)).toHaveLength(1);
        const pageButtons = deepAll(element, 'hcm-button').filter((candidate) => !candidate.classList.contains('confirm'));
        expect(pageButtons.filter((candidate) => candidate.textContent.trim() === 'Delete')).toEqual([]);
    });

    it('happyPath_aRejectedVersionAndAParkedArchiveSeriesOfferIt @S-A125-HAPPY-DELETE-VERSION', async () => {
        const rejected = await imageryPage(shown({ state: 'rejected' }, ENDED), { params: ['version', VERSION.id] });
        expect(deleteButtons(rejected.element)).toHaveLength(1);
        cleanup();

        const parked = await imageryPage(shown({ state: 'needs_gcps', origin: 'archive' }, PARKED), { params: ['version', VERSION.id] });
        // One Delete on the page: the parked series' Cancel-area Delete gives way to this one.
        expect(deleteButtons(parked.element)).toHaveLength(1);
        // (The closed question's own confirm button is not on the page.)
        const pageDeletes = deepAll(parked.element, 'hcm-button').filter((candidate) => !candidate.classList.contains('confirm'));
        expect(pageDeletes.filter((candidate) => candidate.textContent.trim() === 'Delete')).toEqual([]);
    });

    it.each<[string, Partial<VersionViewPort>, JobViewPort | null]>([
        ['published', { state: 'published' }, jobView({ status: 'succeeded', finished: true })],
        ['awaiting approval', { state: 'awaiting_approval' }, jobView()],
        ['processing', { state: 'processing' }, jobView({ status: 'running', waitReason: null })],
        ['failed with its job still running', { state: 'failed' }, jobView({ status: 'running', waitReason: null })],
        ['a USGS frame waiting for points', { state: 'needs_gcps', origin: 'usgs' }, PARKED],
        ['cancelled with its job still stopping', { state: 'cancelled' }, jobView({ status: 'running', cancelRequested: true })],
    ])('badPath_%sOffersNoDeleteThisVersion @S-A125-BAD-DELETE-PUBLISHED', async (_name, version, job) => {
        const { element } = await imageryPage(shown(version, job), { params: ['version', VERSION.id] });

        expect(deleteButtons(element)).toEqual([]);
    });

    it('badPath_aVersionAnotherIsBuiltOnOffersNoDeleteThisVersion @S-A125-BAD-DELETE-RUNNING', async () => {
        const state = shown({ state: 'rejected' }, ENDED);
        const child = versionItem({ id: 'job-child', state: 'failed', basedOn: VERSION.id });
        const { element } = await imageryPage(
            { ...state, versions: { ...state.versions, items: [...state.versions.items, child] } },
            { params: ['version', VERSION.id] },
        );

        expect(deleteButtons(element)).toEqual([]);
    });

    it('badPath_aRefusedDeleteStaysOnThePage @S-A125-BAD-DELETE-RUNNING', async () => {
        const { element, app } = await imageryPage(
            shown({ state: 'cancelled' }, ENDED),
            { params: ['version', VERSION.id] },
            { deleteVersion: Promise.resolve(false) },
        );

        click(button(element, LABEL));
        await updated(element);
        click(deep(deep(element, 'hcm-confirm-dialog'), '.confirm'));
        await updated(element);
        await Promise.resolve();

        expect(app.named('navigate')).toEqual([]);
    });
});
