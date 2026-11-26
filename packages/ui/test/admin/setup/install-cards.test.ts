// The install cards' bodies (docs/research/M6-interfaces.md §1.7, §1.8): Install the server (d), the imagery pipeline
// (d3) and Publish the map (i), each with the install's status, its cost, its button or why it is off.
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineHcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import { defineHcmSetupPipeline } from '../../../src/admin/setup/hcm-setup-pipeline.js';
import { defineHcmSetupSite } from '../../../src/admin/setup/hcm-setup-site.js';
import { installCardAsks } from '../../../src/admin/setup/install-status.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, stepView, type ViewChanges } from './fixtures.js';
import { installSliceView, type InstallChanges } from './install-fixtures.js';

defineHcmSetupDeploy();
defineHcmSetupPipeline();
defineHcmSetupSite();

const RUNNING_STEPS = [
    { id: 'fetch', state: 'done' },
    { id: 'tools', state: 'done' },
    { id: 'rules', state: 'now' },
    { id: 'functions', state: 'waiting' },
    { id: 'verify', state: 'waiting' },
] as const;

/** A normal-mode state with the install slice and the two install steps (the shared fixture lists the nine of M2b). */
function view(install: InstallChanges, changes: ViewChanges = {}) {
    const base = setupView({ ...changes, install: installSliceView(install) });
    const added = { pipeline: stepView('pipeline', changes.steps?.pipeline), site: stepView('site', changes.steps?.site) };
    return { ...base, steps: { ...base.steps, ...added } };
}

async function card(tag: 'deploy' | 'pipeline' | 'site', install: InstallChanges, changes: ViewChanges = {}, locale = 'en') {
    const port = new FakeSetupPort(view(install, changes));
    const templates = {
        deploy: html`<hcm-setup-deploy .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-deploy>`,
        pipeline: html`<hcm-setup-pipeline .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-pipeline>`,
        site: html`<hcm-setup-site .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-site>`,
    };
    const element = await fixture<LitElement>(templates[tag]);
    return { port, element };
}

describe('<hcm-setup-deploy>: Install the server', () => {
    afterEach(cleanup);

    it('happyPath_oneButtonInstallsTheServerAndSaysWhatItCostsAndCountsOnce', async () => {
        const { port, element } = await card(
            'deploy',
            {},
            { steps: { deploy: { state: 'missing', checkedAt: '2026-10-20T10:00:00.000Z' } } },
        );

        // One cost line per card (finding 10 of the M6 review): the step's own, then the build minutes.
        expect(shadowPart(element, '.cost').textContent).toBe(
            "Within the Blaze plan's estimate above. Uses about 85 build minutes; Google Cloud gives 2,500 free each month.",
        );
        expect(element.renderRoot.querySelectorAll('.cost')).toHaveLength(1);
        const counts = [...element.renderRoot.querySelectorAll('p')].filter((p) => p.textContent === '0 of 32 functions installed');
        expect(counts).toHaveLength(1);
        await page.getByRole('button', { name: 'Install the server' }).click();
        expect(port.calls).toEqual([['installServer']]);
        expect(shadowPart(element, '.body').textContent).toContain('The same click also installs the historical imagery pipeline.');
        expect(shadowPart(element, '.body').textContent).not.toMatch(/\b(npm|npx|firebase deploy|gcloud)\b/);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutTheInstallersAccountTheButtonIsOffAndStepCIsOneClickAway', async () => {
        const blocker = {
            key: 'apiError.install.notProvisioned',
            params: { account: 'hcm-installer@demo-hcm.iam.gserviceaccount.com' },
        } as const;
        const { port, element } = await card('deploy', { server: { blocker } }, { steps: { deploy: { state: 'missing' } } });

        await expect.element(page.getByRole('button', { name: 'Install the server' })).toBeDisabled();
        expect(shadowPart(element, '.blocker').textContent).toContain('An account is missing');
        expect(shadowPart(element, '.blocker').textContent).not.toContain('hcm-installer@');
        await page.getByRole('button', { name: 'Open “Prepare the Google Cloud project”' }).click();
        expect(port.calls).toEqual([['open', 'provision']]);
    });

    it('happyPath_aBuildAtWorkShowsItsStepsAndHowLongItRan', async () => {
        const server = {
            state: 'working',
            buildId: 'b-1',
            steps: RUNNING_STEPS,
            runningSince: '2026-10-25T10:00:00.000Z',
            checkedAt: '2026-10-25T10:07:30.000Z',
        } as const;
        const { element } = await card('deploy', { server }, { steps: { deploy: { state: 'pending' } } });

        expect(shadowPart(element, '.install-state').textContent.trim()).toBe('Installing');
        expect(shadowPart(element, '[aria-current="step"]').textContent).toContain('The database and storage rules');
        expect(shadowPart(element, '.body').textContent).toContain('Running for 7 min.');
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aRetrySaysWhatGoogleIsPreparingAndWhen', async () => {
        const server = {
            state: 'retrying',
            steps: RUNNING_STEPS,
            retryReason: 'eventarcAgent',
            retryAt: '2026-10-20T10:10:00.000Z',
        } as const;
        const { element } = await card('deploy', { server }, {}, 'ro');

        expect(shadowPart(element, '.retrying').textContent).toBe(
            'Google încă pregătește serviciul de evenimente; încercăm din nou la 20 oct. 2026, 13:10.',
        );
    });

    it('badPath_aStoppedBuildNamesItsStepShowsItsLogAndOffersTryAgain', async () => {
        const server = {
            state: 'failed',
            buildId: 'b-1',
            consoleUrl: 'https://console.cloud.google.com/cloud-build/builds;region=us-central1/b-1?project=demo-hcm',
            failedStep: 'functions',
            log: ['Error: functions failed', 'Authorization: Bearer [redacted]'],
            missing: ['ops-tick'],
        } as const;
        const { port, element } = await card('deploy', { server }, { steps: { deploy: { state: 'pending' } } });

        expect(shadowPart(element, '.failed-at').textContent).toBe("Stopped at the step: The server's functions.");
        expect(shadowPart(element, '.log').textContent).toBe('Error: functions failed\nAuthorization: Bearer [redacted]');
        expect(shadowPart(element, '.missing').textContent).toBe('Missing functions: ops-tick.');
        expect(element.renderRoot.querySelector('[data-fix]')).toBeNull();
        await expect
            .element(page.getByRole('link', { name: /Open the installation in the Google Cloud console/ }))
            .toHaveAttribute('href', server.consoleUrl);
        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['installServer']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anOlderServerOffersUpdateTheMap_aNewerOneOffersNoUpdate', async () => {
        const older = await card('deploy', { server: { state: 'updateAvailable', installedRelease: '0.9.0' } });

        expect(shadowPart(older.element, '.body').textContent).toContain('An update is ready: 1.0.0+abc1234.');
        await page.getByRole('button', { name: 'Update the map' }).click();
        expect(older.port.calls).toEqual([['updateMap', 'deploy']]);
        cleanup();

        const newer = await card('deploy', { server: { state: 'newerInstalled', installedRelease: '9.0.0' } });
        expect(shadowPart(newer.element, '.body').textContent).toContain('This page is older than the installed version (9.0.0).');
        // The downgrade guard: no Update; only the override, behind its confirmation.
        expect(newer.element.renderRoot.querySelector('hcm-button')).toBeNull();
        expect(newer.element.renderRoot.querySelector('hcm-install-over')).not.toBeNull();
    });

    it('happyPath_anInstalledServerNamesItsReleaseAndTheGithubPathStaysCollapsed', async () => {
        const server = { state: 'installed', installedRelease: '1.0.0+abc1234', finishedAt: '2026-10-20T10:20:00.000Z' } as const;
        const { element } = await card('deploy', { server }, { steps: { deploy: { state: 'ok' } } });

        expect(shadowPart(element, '.body').textContent).toContain('Installed: 1.0.0+abc1234, 20 Oct 2026, 13:20.');
        expect(element.renderRoot.querySelector('details')?.open).toBe(false);
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_inAnAdminSessionAStoppedUpdateOffersTryAgainThoughTheStepIsDone', async () => {
        // Finding 1 of the M6 review: the step's Done chip hid the button; the install's own state decides.
        const server = { state: 'failed', failedStep: 'verify', checkedAt: '2026-10-20T10:00:00.000Z' } as const;
        const { port } = await card('deploy', { server }, { steps: { deploy: { state: 'ok' } } });

        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['installServer']]);
    });

    it('badPath_aDoneStepOrOneNotLookedAtShowsNoFunctionCount', async () => {
        // Finding 9 of the M6 review: "0 of 69 functions installed" beside a Done chip, before any look.
        const done = await card('deploy', {}, { steps: { deploy: { state: 'ok' } } });
        expect(shadowPart(done.element, '.body').textContent).not.toContain('functions installed');
        expect(done.element.renderRoot.querySelector('hcm-progress')).toBeNull();
        expect(done.element.renderRoot.querySelector('hcm-button')).toBeNull();
        cleanup();

        const unseen = await card('deploy', {}, { steps: { deploy: { state: 'missing' } } });
        expect(shadowPart(unseen.element, '.body').textContent).not.toContain('functions installed');
    });

    it('badPath_aCheckThatFailedIsAnAlert', async () => {
        const { element } = await card('deploy', {
            server: { state: 'unavailable', error: { key: 'apiError.unavailable' } },
        });

        expect(shadowPart(element, '[role="alert"]').textContent).toContain('unavailable');
    });
});

describe('<hcm-setup-deploy>: a permission of step c (finding 28 of 2026-10-31)', () => {
    afterEach(cleanup);

    it('badPath_aBuildStoppedAtAPermissionOfStepCSaysToRetryThereFirst', async () => {
        // Finding 28 of 2026-10-31: firebase-tools' actAs check; Try again alone would stop the same way.
        const server = {
            state: 'failed',
            failedStep: 'functions',
            log: ['Error: Missing permissions required for functions deploy.'],
            fixInProvision: true,
        } as const;
        const { port, element } = await card('deploy', { server }, { steps: { deploy: { state: 'pending' } } }, 'ro');

        expect(shadowPart(element, '[data-fix="provision"]').textContent).toContain(
            'Lipsește o permisiune: reia ce nu a reușit la „Pregătirea proiectului Google Cloud”.',
        );
        await page.getByRole('button', { name: 'Reia ce nu a reușit la „Pregătirea proiectului Google Cloud”' }).click();
        expect(port.calls).toEqual([['provision']]);
        await expect.element(page.getByRole('button', { name: 'Încearcă din nou' })).toBeEnabled();
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-setup-pipeline>', () => {
    afterEach(cleanup);

    it('happyPath_beforeTheServersClickItSaysWhenItStarts', async () => {
        const { element } = await card('pipeline', {});

        expect(shadowPart(element, '.body').textContent).toContain(
            "It starts when you choose “Install the server” in “Install the map's server”.",
        );
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aStoppedBuildOffersTryAgain_andNoRepositoryIsSaid', async () => {
        const pipeline = { state: 'failed', failedStep: 'build', log: ['docker: build failed'] } as const;
        const { port, element } = await card('pipeline', { pipeline, server: { buildId: 'b-0' } });

        expect(shadowPart(element, '.body').textContent).not.toContain('It starts when');
        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['install', 'pipeline']]);
        cleanup();

        const blocked = await card('pipeline', {
            pipeline: { blocker: { key: 'apiError.install.noRepository', params: { repository: 'hcm' } } },
        });
        expect(shadowPart(blocked.element, '.blocker').textContent).toContain('The image repository is missing');
    });

    it('badPath_aBuildStoppedForAQuotaNamesItAndLinksItsQuotasPage', async () => {
        // Finding 47 of 2026-11-01: the `jobs` step's `quota` line; Try again alone meets the same limit.
        const quota = { service: 'run.googleapis.com', metric: 'run.googleapis.com/cpu_allocation', limit: 'CpuAllocPerProjectRegion' };
        const consoleUrl = 'https://console.cloud.google.com/cloud-build/builds;region=us-central1/b-1?project=demo-hcm';
        const pipeline = { state: 'failed', failedStep: 'jobs', log: ['jobs: Google Cloud refused'], quota, consoleUrl } as const;
        const { element } = await card('pipeline', { pipeline }, {}, 'ro');

        const line = shadowPart(element, '[data-fix="quota"]');
        expect(line.textContent).toContain(
            'Google Cloud a refuzat o cotă: run.googleapis.com/cpu_allocation (limita CpuAllocPerProjectRegion).',
        );
        expect(line.textContent).toContain('Un proiect de probă gratuită are cote mai mici');
        expect(line.querySelector('a')?.getAttribute('href')).toBe(
            'https://console.cloud.google.com/iam-admin/quotas?project=demo-hcm&service=run.googleapis.com',
        );
        await expect.element(page.getByRole('button', { name: 'Încearcă din nou' })).toBeEnabled();
        expect(await axeViolations(element)).toEqual([]);
        cleanup();

        // A stopped build without a console page still names the quota (its link has no project then).
        const unlinked = await card('pipeline', { pipeline: { ...pipeline, consoleUrl: null } });
        expect(shadowPart(unlinked.element, '[data-fix="quota"] a').getAttribute('href')).toBe(
            'https://console.cloud.google.com/iam-admin/quotas?project=&service=run.googleapis.com',
        );
        expect(unlinked.element.renderRoot.querySelectorAll('[data-fix="quota"]')).toHaveLength(1);
    });

    it('happyPath_aPipelineMissingBesideAnInstalledServerHasItsOwnButton', async () => {
        // Finding 3 of the M6 review: a server installed some other way, or a pipeline blocked at the server's click.
        const looked = { checkedAt: '2026-10-20T10:00:00.000Z' };
        const { port, element } = await card('pipeline', { pipeline: looked, server: { state: 'installed' } });

        expect(shadowPart(element, '.body').textContent).not.toContain('It starts when');
        await page.getByRole('button', { name: 'Install the pipeline' }).click();
        expect(port.calls).toEqual([['install', 'pipeline']]);
        cleanup();

        const blocked = await card('pipeline', {
            pipeline: { ...looked, blocker: { key: 'apiError.install.noRepository', params: { repository: 'hcm' } } },
            server: { state: 'installed' },
        });
        await expect.element(page.getByRole('button', { name: 'Install the pipeline' })).toBeDisabled();
        expect(shadowPart(blocked.element, '.blocker').textContent).toContain('Not available yet:');
    });

    it('badPath_aBundleThatCannotInstallThePipelineSaysSoAndOffersNoButton', async () => {
        // Finding 43 of 2026-11-01: a record says looked at and not installed; the bundle names no Docker builder.
        const looked = { checkedAt: '2026-10-20T10:00:00.000Z' };
        const off = { key: 'apiError.install.notAvailable' } as const;
        const { element } = await card('pipeline', { pipeline: looked, server: { state: 'installed' }, pipelineOff: off });

        const reason = shadowPart(element, '.blocker').textContent;
        expect(reason).toContain('Not available yet:');
        expect(reason).toContain('This part cannot be installed from here yet; the map works without it.');
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
        expect(shadowPart(element, '.body').textContent).not.toContain('It starts when');
        expect(await axeViolations(element)).toEqual([]);
        cleanup();

        // The same answer from a look at Google, and a stopped build: still no button.
        const failed = await card('pipeline', { pipeline: { ...looked, state: 'failed', blocker: off }, server: { state: 'installed' } });
        expect(failed.element.renderRoot.querySelector('hcm-button')).toBeNull();
        cleanup();

        // The server's card does not promise the pipeline with its click.
        const deploy = await card('deploy', { pipelineOff: off }, { steps: { deploy: { state: 'missing', checkedAt: looked.checkedAt } } });
        expect(shadowPart(deploy.element, '.body').textContent).not.toContain('also installs the historical imagery pipeline');
    });
});

describe('<hcm-setup-site>: Publish the map', () => {
    afterEach(cleanup);

    it('happyPath_publishIsOneClickToTheProjectsAddress', async () => {
        const { port, element } = await card('site', {}, { steps: { site: { state: 'missing' } } });

        expect(shadowPart(element, '.body').textContent).toContain("The map's address: https://demo-hcm.web.app/");
        // Finding 4 of the M6 security review: what one publish moves out of Hosting's free daily transfer.
        expect(shadowPart(element, '.cost').textContent).toContain('Each publish also moves about 60 MB of Hosting’s free daily transfer.');
        expect(shadowPart(element, '.body').textContent).toContain('Tip: import the old photos first');
        await page.getByRole('button', { name: 'Publish the map' }).click();
        expect(port.calls).toEqual([['install', 'site']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_nothingToShowKeepsTheButtonOffAndSaysWhy', async () => {
        const { element } = await card(
            'site',
            { site: { blocker: { key: 'apiError.install.nothingToShow' } } },
            { steps: { legacyImport: { state: 'ok' } } },
        );

        await expect.element(page.getByRole('button', { name: 'Publish the map' })).toBeDisabled();
        expect(shadowPart(element, '.blocker').textContent).toContain('The map has nothing to show yet');
        expect(shadowPart(element, '.body').textContent).not.toContain('Tip:');
    });

    it('happyPath_aPublishedMapIsALink', async () => {
        const { element } = await card('site', { site: { state: 'installed', installedRelease: '1.0.0+abc1234' } });

        await expect.element(page.getByRole('link', { name: /Open the public map/ })).toHaveAttribute('href', 'https://demo-hcm.web.app/');
        expect(shadowPart(element, '.success').textContent).toBe('The map is public.');
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_aStoppedPublishOffersTryAgain', async () => {
        const { port } = await card('site', { site: { state: 'failed', failedStep: 'hosting' } });

        await page.getByRole('button', { name: 'Try again' }).click();
        expect(port.calls).toEqual([['install', 'site']]);
    });
});

describe('the installed line', () => {
    afterEach(cleanup);

    it('happyPath_aReleaseWithoutABuildOfThisAdminIsShownUndated', async () => {
        const recorded = { state: 'updateAvailable', installedRelease: '0.9.0+abc0000' } as const;
        const { element } = await card('deploy', { server: recorded }, { steps: { deploy: { state: 'ok' } } });

        const notes = [...element.renderRoot.querySelectorAll('p.note')].map((note) => note.textContent);
        expect(notes).toContain('Installed: 0.9.0+abc0000.');
    });

    it('badPath_aServerNewerThanTheAdminShowsNoInstalledLine', async () => {
        const newer = { state: 'newerInstalled', installedRelease: '99.0.0+abc9999' } as const;
        const { element } = await card('deploy', { server: newer }, { steps: { deploy: { state: 'ok' } } });

        const notes = [...element.renderRoot.querySelectorAll('p.note')].map((note) => note.textContent);
        expect(notes.some((note) => note.startsWith('Installed:'))).toBe(false);
    });
});

describe("<hcm-setup-deploy>: Install this admin's version anyway (the live finding of 2026-11-12)", () => {
    afterEach(cleanup);

    it('happyPath_theOverrideAsksFirstThenInstallsThisAdminsReleaseOverTheNewerOne @S-A55-HAPPY-INSTALL-OVER', async () => {
        // The live finding of 2026-11-12: a rollback is the owner's choice, confirmed in a dialog that says what it replaces.
        const { port, element } = await card('deploy', { server: { state: 'newerInstalled', installedRelease: '9.0.0' } });

        await page.getByRole('button', { name: "Install this admin's version anyway" }).click();
        expect(port.calls).toEqual([]);
        await expect.element(page.getByRole('dialog', { name: 'Replace a newer release?' })).toBeVisible();
        await expect
            .element(page.getByText('This replaces the newer 9.0.0 with the older 1.0.0+abc1234: a rollback, marked in Cloud Build.'))
            .toBeVisible();
        await page.getByRole('button', { name: 'Install 1.0.0+abc1234' }).click();
        expect(port.calls).toEqual([['installOver', 'server']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_keepingTheNewerReleaseInstallsNothing_andABuildUnderWayTurnsTheOverrideOff', async () => {
        const { port } = await card('deploy', { server: { state: 'newerInstalled', installedRelease: '9.0.0' } }, {}, 'ro');

        await page.getByRole('button', { name: 'Instalează totuși versiunea acestei administrări' }).click();
        await page.getByRole('button', { name: 'Păstrează 9.0.0' }).click();
        expect(port.calls).toEqual([]);
        cleanup();

        const busy = await card('deploy', {
            server: { state: 'newerInstalled', installedRelease: '9.0.0' },
            site: { state: 'working' },
        });
        const over = busy.element.renderRoot.querySelector<HTMLElement & { disabled: boolean }>('hcm-install-over');
        expect(over?.disabled).toBe(true);
    });
});

describe('installCardAsks (finding 40 of 2026-11-01)', () => {
    const LOOKED = '2026-11-01T09:00:00Z';

    it('happyPath_aCardWhoseBodyOffersAButtonThatAsksGoogle', () => {
        expect(installCardAsks(view({ pipeline: { state: 'failed', checkedAt: LOOKED } }), 'pipeline')).toBe(true);
        expect(
            installCardAsks(view({ server: { state: 'installed', checkedAt: LOOKED }, pipeline: { checkedAt: LOOKED } }), 'pipeline'),
        ).toBe(true);
        expect(installCardAsks(view({ site: { state: 'notInstalled' } }), 'site')).toBe(true);
        expect(installCardAsks(view({ site: { state: 'updateAvailable' } }), 'site')).toBe(true);
        // The live finding of 2026-11-12: a newer target offers Install this admin's version anyway, which asks Google.
        expect(installCardAsks(view({ server: { state: 'newerInstalled', checkedAt: LOOKED } }), 'deploy')).toBe(true);
        // Not an install card: the frame decides as before.
        expect(installCardAsks(view({}), 'billing')).toBe(true);
    });

    it('badPath_aCardWithNothingToDoAsksNothing', () => {
        expect(installCardAsks(view({ site: { state: 'installed', checkedAt: LOOKED } }), 'site')).toBe(false);
        expect(installCardAsks(view({ pipeline: { state: 'working', checkedAt: LOOKED } }), 'pipeline')).toBe(false);
        expect(installCardAsks(view({ pipeline: { state: 'notInstalled' } }), 'pipeline')).toBe(false);
        // Finding 43: a pipeline this admin cannot install offers no button, so no consent note.
        const off = { key: 'apiError.install.notAvailable' } as const;
        expect(
            installCardAsks(view({ server: { state: 'installed' }, pipeline: { checkedAt: LOOKED }, pipelineOff: off }), 'pipeline'),
        ).toBe(false);
    });
});

describe('<hcm-setup-deploy>: an update under way (finding 70 of 2026-11-02)', () => {
    afterEach(cleanup);

    it('badPath_whileABuildRunsNeitherUpdateTheMapNorTheProvisionLineIsOffered @S-A55-BAD-UPDATE-DURING-BUILD', async () => {
        // Finding 70 of 2026-11-02: the card still offered Update the map and the Provision line beside its own build.
        const due = { provisionDue: ['artifact-registry', 'bucket-lifecycle'] } as const;
        const working = await card('deploy', { ...due, server: { state: 'working', steps: RUNNING_STEPS, startedAt: null } });

        expect(working.element.renderRoot.querySelector('[data-provision-due]')).toBeNull();
        expect(shadowPart(working.element, '.body').textContent).not.toContain('Update the map');
        cleanup();

        const pipelineBuilds = await card('deploy', { ...due, pipeline: { state: 'queued' } });
        expect(pipelineBuilds.element.renderRoot.querySelector('[data-provision-due]')).toBeNull();
        cleanup();

        // Every build settled: the changed settings are offered again.
        const idle = await card('deploy', { ...due, server: { state: 'installed', installedRelease: '1.0.0+abc1234' } });
        expect(idle.element.renderRoot.querySelector('[data-provision-due]')).not.toBeNull();
        await page.getByRole('button', { name: 'Update the map' }).click();
        expect(idle.port.calls).toEqual([['updateMap', 'deploy']]);
    });
});
