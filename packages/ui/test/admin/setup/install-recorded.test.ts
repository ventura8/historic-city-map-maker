// A recorded build at work is not shown as running before a look (the live finding of 2026-11-08: right after Setup
// opened, steps d and d3 said "Installing" with every step "next" until Cloud Build answered "An update is ready").
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineHcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import { defineHcmSetupPipeline } from '../../../src/admin/setup/hcm-setup-pipeline.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, stepView } from './fixtures.js';
import { installSliceView, type InstallChanges } from './install-fixtures.js';

defineHcmSetupDeploy();
defineHcmSetupPipeline();

const SEEN = '2026-11-08T09:00:00.000Z';

async function card(tag: 'deploy' | 'pipeline', install: InstallChanges, locale = 'en') {
    const base = setupView({ install: installSliceView(install) });
    const port = new FakeSetupPort({ ...base, steps: { ...base.steps, pipeline: stepView('pipeline'), site: stepView('site') } });
    const templates = {
        deploy: html`<hcm-setup-deploy .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-deploy>`,
        pipeline: html`<hcm-setup-pipeline .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-pipeline>`,
    };
    return fixture<LitElement>(templates[tag]);
}

describe('a recorded build at work, before the card looks', () => {
    afterEach(cleanup);

    it('happyPath_whileALookRunsTheCardSaysItIsCheckingWithNoStepsAndWhenItWasLastSeen', async () => {
        const recorded = { state: 'working', recorded: true, looking: true, checkedAt: SEEN, buildId: '0e2e0b1d-0001' } as const;
        const server = await card('deploy', { server: recorded });
        const pipeline = await card('pipeline', { pipeline: { ...recorded, state: 'queued' } }, 'ro');

        expect(shadowPart(server, '.install-state').dataset['state']).toBe('checking');
        expect(shadowPart(server, '.install-state').textContent.trim()).toBe('Checking the installation…');
        expect(shadowPart(server, '.install').textContent).toContain('Last seen installing on');
        expect(shadowPart(server, '.install').textContent).not.toContain('Installing');
        expect(server.renderRoot.querySelector('.build-steps')).toBeNull();
        expect(shadowPart(pipeline, '.install-state').textContent.trim()).toBe('Se verifică instalarea…');
        expect(pipeline.renderRoot.querySelector('.build-steps')).toBeNull();
        expect(await axeViolations(server)).toEqual([]);
    });

    it('badPath_withNoLookUnderWayTheCardNeverSaysCheckingButWhenItWasLastSeenAndToCheckAgain', async () => {
        // Review of 6858f8a, finding (a): with no Google token nothing looks, yet the card said "Checking…" for good.
        const recorded = { state: 'working', recorded: true, checkedAt: SEEN, buildId: '0e2e0b1d-0001' } as const;
        const server = await card('deploy', { server: recorded });
        const pipeline = await card('pipeline', { pipeline: { ...recorded, state: 'queued' } }, 'ro');

        expect(shadowPart(server, '.install-state').dataset['state']).toBe('lastSeen');
        expect(shadowPart(server, '.install-state').textContent.trim()).toMatch(/^Last seen installing on .+\. Check again to see now\.$/);
        expect(shadowPart(server, '.install').textContent).not.toContain('Checking');
        expect(shadowPart(server, '.install').textContent).not.toContain('Installing');
        expect(server.renderRoot.querySelector('.build-steps')).toBeNull();
        expect(shadowPart(pipeline, '.install-state').textContent.trim()).toMatch(
            /^Văzută ultima dată instalându-se pe .+\. Verifică din nou/,
        );
        expect(await axeViolations(server)).toEqual([]);
    });

    it('badPath_aRecordedBuildWhoseLookFailedStaysLastSeenWithTheError_andHoldsBackUpdateTheMap', async () => {
        // A failed read says nothing of the build: as "Unavailable now" it no longer counted as at work, and Update the map
        // came back beside it (the review of the stale fixes).
        const error = { key: 'apiError.unavailable' } as const;
        const server = { state: 'working', recorded: true, checkedAt: SEEN, error } as const;
        const element = await card('deploy', { server, pipeline: { state: 'updateAvailable', checkedAt: SEEN } });

        expect(shadowPart(element, '.install-state').dataset['state']).toBe('lastSeen');
        expect(shadowPart(element, '.install').textContent).not.toContain('Checking');
        expect(shadowPart(element, '.alert').textContent).not.toBe('');
        await expect.element(page.getByRole('button', { name: 'Update the map' })).not.toBeInTheDocument();
    });

    it('badPath_aBuildTheCardSawAtWorkStillShowsItsSteps_andARecordedEndedOneItsState', async () => {
        const looked = await card('deploy', { server: { state: 'working', checkedAt: SEEN, runningSince: SEEN } });
        const ended = await card('pipeline', { pipeline: { state: 'installed', recorded: true, checkedAt: SEEN } });

        expect(shadowPart(looked, '.install-state').textContent.trim()).toBe('Installing');
        expect(looked.renderRoot.querySelector('.build-steps')).not.toBeNull();
        expect(shadowPart(looked, '.install').textContent).not.toContain('Last seen');
        expect(shadowPart(ended, '.install-state').dataset['state']).toBe('installed');
    });

    it('badPath_aBuildOnlyARecordSaysIsAtWorkNeverHidesUpdateTheMap_aBuildALookSawAtWorkDoes @S-A55-BAD-UPDATE-STALE-RECORD', async () => {
        // 2026-11-14: the pipeline's record of 23:20 hid Update the map with no word why; the click now looks at such a build
        // first (the admin's updateMap), so the race finding 71 fixed stays closed.
        const update = { state: 'updateAvailable', checkedAt: SEEN } as const;
        await card('deploy', { server: update, pipeline: { state: 'working', recorded: true, checkedAt: SEEN } });
        await expect.element(page.getByRole('button', { name: 'Update the map' })).toBeVisible();
        cleanup();

        await card('deploy', { server: update, pipeline: { state: 'working', checkedAt: SEEN } });
        await expect.element(page.getByRole('button', { name: 'Update the map' })).not.toBeInTheDocument();
    });
});

describe('how long a build has been at work (the live finding of 2026-11-08)', () => {
    afterEach(cleanup);

    it('badPath_aQueuedBuildNamesNoDuration_evenWhenItWasCreatedMinutesBeforeTheBrowsersLook', async () => {
        // Right after Update the map, step d said "Waiting for Google Cloud Build" and "Running for 3 min." at once: the
        // build's creation time on Google's clock against the browser's.
        const server = await card('deploy', {
            server: { state: 'queued', buildId: 'b-1', startedAt: '2026-11-08T10:00:00.000Z', checkedAt: '2026-11-08T10:03:10.000Z' },
        });

        expect(shadowPart(server, '.install-state').textContent.trim()).toBe('Waiting for Google Cloud Build');
        expect(shadowPart(server, '.install').textContent).not.toContain('Running for');
    });

    it('happyPath_aBuildAtWorkCountsFromWhenItStartedWork', async () => {
        const server = await card('deploy', {
            server: { state: 'working', buildId: 'b-1', runningSince: '2026-11-08T10:00:00.000Z', checkedAt: '2026-11-08T10:03:10.000Z' },
        });

        expect(shadowPart(server, '.install').textContent).toContain('Running for 3 min.');
    });
});
