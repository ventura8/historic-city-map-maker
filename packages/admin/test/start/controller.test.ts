/**
 * The start page's run (`docs/research/M14-start-your-map.md`) end to end over the fake upstreams, with the browser's other
 * parts as plain objects: every step looks before it acts, a failure says why and what to do, a reload resumes.
 */
import { describe, expect, it, vi } from 'vitest';

import { StartController } from '../../src/start/controller.js';
import { rememberState, savePlan, type StartPlan } from '../../src/start/plan.js';
import { BASE, grantFragment, releaseOf, sha, SLUG, startWorld, type StartWorld } from './fakes.js';

const PROJECT = 'fostul-bacau';
const PLAN: StartPlan = { projectId: PROJECT, displayName: 'Fostul Bacau', create: true, city: { id: 'bacau', name: { ro: 'Bacău' } } };

function hostingState(world: StartWorld): {
    readonly live: Readonly<Record<string, string>>;
    readonly versions: Readonly<Record<string, { readonly files: Readonly<Record<string, string>>; readonly config: unknown }>>;
} {
    return world.fakes.snapshot()['firebase-hosting'] as never;
}

async function signedIn(world: StartWorld): Promise<StartController> {
    rememberState(world.deps.session, 'state-1');
    world.fragment = grantFragment('state-1');
    const controller = new StartController(world.deps);
    await controller.start();
    return controller;
}

function fill(controller: StartController): void {
    controller.intents.setName('Fostul Bacău');
    controller.intents.setCityId('bacau');
    controller.intents.setProjectId(PROJECT);
}

async function settled(controller: StartController): Promise<void> {
    for (let tick = 0; tick < 2000 && (controller.view.busy || controller.view.screen === 'plan'); tick += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (controller.view.failure !== null) {
            return;
        }
    }
    for (let tick = 0; tick < 50; tick += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

describe('the start page', () => {
    it('happyPath_fromNothingToAReleaseWithTheProjectFilledIn', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        expect(controller.view.screen).toBe('plan');
        expect(world.fragment).toBe('');
        fill(controller);

        controller.intents.go();
        await settled(controller);

        expect(controller.view.failure).toBeNull();
        expect(controller.view.screen).toBe('provider');
        expect(controller.view.steps).toEqual({
            project: 'done',
            firebase: 'done',
            webApp: 'done',
            site: 'done',
            files: 'done',
            release: 'done',
        });
        const { live, versions } = hostingState(world);
        const version = versions[live[PROJECT] ?? ''];
        expect(Object.keys(version?.files ?? {}).sort((a, b) => a.localeCompare(b))).toEqual([
            '/admin/project.json',
            '/city/config.js',
            '/index.html',
        ]);
        expect(JSON.stringify(version?.config)).toContain(PROJECT);
        expect(JSON.stringify(version?.config)).not.toContain('__HCM_PROJECT_ID__');
        expect(world.fakes.callsTo('start.hosting.upload')).toHaveLength(3);
    });

    it('happyPath_theConsoleClickIsDetected', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);

        controller.intents.checkProvider();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'provider', providerWaiting: true });

        world.fakes.scenario('firebase-hosting.googleSignInOn');
        controller.intents.checkProvider();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'done', providerWaiting: false });
    });

    it('happyPath_aConsentAndAPlanResumeTheRunAndNothingIsMadeTwice', async () => {
        const world = startWorld();
        savePlan(world.deps.session, PLAN);
        world.fakes.state.startWorld.projects.set(PROJECT, 'Fostul Bacău');
        const controller = await signedIn(world);
        await settled(controller);
        expect(controller.view.screen).toBe('provider');
        expect(world.fakes.callsTo('start.projects.create')).toHaveLength(0);
    });

    it('happyPath_aReloadKeepsThePlanAndAsksForTheToken', async () => {
        const world = startWorld();
        savePlan(world.deps.session, PLAN);
        const controller = new StartController(world.deps);
        await controller.start();
        expect(controller.view).toMatchObject({ screen: 'work', plan: PLAN, failure: { key: 'start.failure.expired', action: 'consent' } });

        controller.intents.tryAgain();
        expect(world.assigned[0]).toContain('response_type=token');
        expect(world.assigned[0]).toContain(encodeURIComponent(BASE));
    });

    it('happyPath_aProjectTheOwnerHasIsUsedNotMade', async () => {
        const world = startWorld();
        world.fakes.scenario('firebase-hosting.ownedProject');
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.setCreate(false);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        expect(controller.view.projects?.map((project) => project.projectId)).toEqual(['demo-hcm']);
        controller.intents.setPicked('demo-hcm');
        controller.intents.go();
        await settled(controller);
        expect(controller.view.screen).toBe('provider');
        expect(world.fakes.callsTo('start.projects.create')).toHaveLength(0);
        expect(world.fakes.callsTo('start.firebase.add')).toHaveLength(0);
    });
});

describe('the start page, when it cannot go on', () => {
    it('badPath_noClientMeansTheClosedScreen', async () => {
        const world = startWorld();
        world.configBody = { release: SLUG };
        const controller = new StartController(world.deps);
        await controller.start();
        expect(controller.view.screen).toBe('closed');
    });

    it('badPath_anUnreadableConfigurationMeansTheClosedScreen', async () => {
        const world = startWorld();
        world.configBody = undefined;
        const controller = new StartController(world.deps);
        await controller.start();
        expect(controller.view.screen).toBe('closed');
    });

    it.each([
        ['#error=access_denied&state=state-1', 'start.signedOut.denied'],
        ['#error=access_denied&state=other', 'start.signedOut.state'],
        [grantFragment('state-1', ['https://www.googleapis.com/auth/firebase']), 'start.signedOut.scope'],
    ])('badPath_anAnswerThatGivesNothing_%s', async (fragment, notice) => {
        const world = startWorld();
        rememberState(world.deps.session, 'state-1');
        world.fragment = fragment;
        const controller = new StartController(world.deps);
        await controller.start();
        expect(controller.view).toMatchObject({ screen: 'intro', notice });
    });

    it('badPath_theTermsStopTheRunAndTryAgainContinues', async () => {
        const world = startWorld();
        world.fakes.scenario('firebase-hosting.termsNotAccepted');
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(controller.view.failure).toMatchObject({
            key: 'start.failure.terms',
            link: { url: 'https://console.firebase.google.com/' },
        });
        expect(controller.view.steps.firebase).toBe('failed');

        world.fakes.scenario('firebase-hosting.termsAccepted');
        controller.intents.tryAgain();
        await settled(controller);
        expect(controller.view.screen).toBe('provider');
        expect(world.fakes.callsTo('start.projects.create')).toHaveLength(1);
    });

    it('badPath_aTakenIdOffersAFreeOne', async () => {
        const world = startWorld();
        world.fakes.scenario('firebase-hosting.idTaken');
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'plan', failure: { key: 'start.failure.taken' }, plan: null });
        expect(controller.view.form.projectId).toBe(`${PROJECT}-2`);
    });

    it('badPath_aFileThatIsNotTheManifestsStopsBeforeAnyRelease', async () => {
        const world = startWorld();
        world.files.set(`release/${SLUG}/tree/index.html`, new TextEncoder().encode('tampered'));
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(controller.view.failure).toMatchObject({ key: 'start.failure.file', params: { path: 'index.html' } });
        expect(hostingState(world).live).toEqual({});
    });

    it('badPath_aMissingFileOrManifestSaysSo', async () => {
        const world = startWorld();
        world.files.delete(`release/${SLUG}/tree/index.html`);
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(controller.view.failure?.key).toBe('start.failure.file');

        world.releaseBody = undefined;
        controller.intents.tryAgain();
        await settled(controller);
        expect(controller.view.failure?.key).toBe('start.failure.release');
    });

    it('badPath_anUploadThatNeverLeavesNamesTheHostAndTheTerminal', async () => {
        const world = startWorld();
        world.uploadDown = true;
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(controller.view.failure).toMatchObject({
            key: 'start.failure.network',
            params: { host: 'upload-firebasehosting.googleapis.com', command: 'npx create-historic-city@1 self-host' },
        });
        expect(hostingState(world).live).toEqual({});
    });

    it('badPath_anExpiredTokenStopsWithContinue', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        fill(controller);
        world.now += 3600 * 1000;
        controller.intents.go();
        await settled(controller);
        expect(controller.view.failure).toMatchObject({ key: 'start.failure.expired', action: 'consent' });
        controller.intents.checkProvider();
        expect(world.assigned).toHaveLength(1);
    });

    it('edge_aManifestListingNothingElseStillReleasesTheProjectFile', async () => {
        const world = startWorld();
        const only = new TextEncoder().encode('x');
        world.files.set(`release/${SLUG}/tree/a.txt`, only);
        world.releaseBody = releaseOf({ files: [{ path: 'a.txt', bytes: 1, sha256: sha(only) }] });
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(Object.keys(hostingState(world).versions)).toHaveLength(1);
        expect(controller.view.files).toEqual({ done: 2, total: 2 });
    });
});

describe('the start page, its smaller parts', () => {
    it('happyPath_theFormsOtherFieldsAndTheWayBackToANewProject', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        controller.intents.setNameEn('Old Bacău');
        controller.intents.setEdge('west', '26.85');
        controller.intents.setCreate(false);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        controller.intents.setCreate(false);
        controller.intents.setCreate(true);
        expect(controller.view.form).toMatchObject({ nameEn: 'Old Bacău', create: true, area: { west: '26.85' } });
        expect(controller.view.projects).toEqual([]);
    });

    it('badPath_aListThatFailsShowsNoProjects', async () => {
        const world = startWorld();
        world.fakes.fail('firebase-hosting', 'forbidden');
        const controller = await signedIn(world);
        controller.intents.setCreate(false);
        for (let tick = 0; tick < 200 && controller.view.projects === null; tick += 1) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        expect(controller.view.projects).toEqual([]);
    });

    it('badPath_aFormNotReadyDoesNothing', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        controller.intents.go();
        await new Promise((resolve) => setImmediate(resolve));
        expect(controller.view.screen).toBe('plan');
        controller.intents.tryAgain();
        controller.intents.checkProvider();
        await new Promise((resolve) => setImmediate(resolve));
        expect(controller.view.screen).toBe('plan');
    });

    it('badPath_aProviderThatCannotBeReadIsSaidApartFromNotYet', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'provider', providerWaiting: false, providerUnreadable: false });
        controller.intents.checkProvider();
        await settled(controller);
        expect(controller.view).toMatchObject({ providerWaiting: true, providerUnreadable: false });
        world.fakes.fail('firebase-management', 'forbidden');
        controller.intents.checkProvider();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'provider', providerWaiting: false, providerUnreadable: true });
    });

    it('badPath_aCityNameGoogleWouldRefuseIsCleanedForTheProject', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        controller.intents.setName('Sf. Gheorghe, vechi');
        controller.intents.setCityId('sf-gheorghe');
        controller.intents.setProjectId(PROJECT);
        controller.intents.go();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'provider', failure: null });
        const { projects } = world.fakes.snapshot()['firebase-hosting'] as { readonly projects: Readonly<Record<string, string>> };
        expect(projects[PROJECT]).toBe('Sf Gheorghe vechi');
    });

    it('badPath_aProjectGoogleRefusesGoesBackToTheForm', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        fill(controller);
        world.fakes.scenario('firebase-hosting.projectRefused');
        controller.intents.go();
        await settled(controller);
        expect(controller.view).toMatchObject({ screen: 'plan', failure: { key: 'start.failure.refused', action: 'form' } });
        expect(world.session.has('hcm:start:plan')).toBe(false);
    });
});

describe('the start page, after the release', () => {
    it('happyPath_aFirstVisitOpensTheIntro_andTheConsentCarriesTheTestsPartition', async () => {
        const world = startWorld();
        world.deps = { ...world.deps, testId: 'a test' };
        const controller = new StartController(world.deps);
        await controller.start();
        expect(controller.view.screen).toBe('intro');
        controller.intents.signIn();
        expect(world.assigned[0]).toContain('test=');
    });

    it('badPath_afterTheReleaseAnExpiredCheckDoesNotReleaseAgain', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);
        const versions = Object.keys(hostingState(world).versions);
        expect(versions).toHaveLength(1);

        world.now += 2 * 3_600_000;
        world.assigned.length = 0;
        controller.intents.checkProvider();
        await settled(controller);
        expect(world.assigned).toHaveLength(1);

        const back = await signedIn(world);
        await settled(back);
        expect(back.view).toMatchObject({ screen: 'provider', failure: null, plan: { projectId: PROJECT } });
        expect(Object.keys(hostingState(world).versions)).toEqual(versions);
    });

    it('badPath_aReloadAfterTheReleaseOpensTheProviderStep', async () => {
        const world = startWorld();
        const controller = await signedIn(world);
        fill(controller);
        controller.intents.go();
        await settled(controller);

        const reloaded = new StartController(world.deps);
        await reloaded.start();
        expect(reloaded.view).toMatchObject({ screen: 'provider', failure: null, plan: { projectId: PROJECT } });
    });

    it('badPath_anotherTabWithTheSameNewProjectLeavesTheLiveSite', async () => {
        const world = startWorld();
        const first = await signedIn(world);
        fill(first);
        first.intents.go();
        await settled(first);
        const { live } = hostingState(world);

        world.session.clear();
        const again = await signedIn(world);
        fill(again);
        again.intents.go();
        await settled(again);
        expect(again.view.screen).toBe('provider');
        expect(hostingState(world).live).toEqual(live);
        expect(Object.keys(hostingState(world).versions)).toHaveLength(1);
    });

    it('edge_aConfigurationThatIsNoJson', async () => {
        const world = startWorld();
        const plain = world.deps.fetch;
        world.deps = { ...world.deps, fetch: () => Promise.resolve(new Response('not json')) };
        const controller = new StartController(world.deps);
        await controller.start();
        expect(controller.view.screen).toBe('closed');
        world.deps = { ...world.deps, fetch: () => Promise.reject(new TypeError('down')) };
        const down = new StartController(world.deps);
        await down.start();
        expect(down.view.screen).toBe('closed');
        world.deps = { ...world.deps, fetch: plain };
    });

    it('language_followsTheAddressThenTheChoice', () => {
        const world = startWorld();
        const controller = new StartController(world.deps);
        expect(controller.view.locale).toBe('en');
        let heard = 0;
        const stop = controller.subscribe(() => {
            heard += 1;
        });
        controller.intents.setLocale('ro');
        stop();
        controller.intents.setLocale('en');
        expect(heard).toBe(1);
        expect(world.local.get('hcm:start:lang')).toBe('en');
    });

    it('happyPath_aLanguageBeyondTheBundledTwoShowsOnceItsTextsAreHere', async () => {
        const world = startWorld();
        const loadTexts = vi.fn(() => Promise.resolve(true));
        const controller = new StartController({ ...world.deps, search: '?lang=uk', loadTexts });
        expect(controller.view.locale).toBe('en');
        await controller.start();
        await vi.waitFor(() => {
            expect(controller.view.locale).toBe('uk');
        });
        controller.intents.setLocale('ko');
        await vi.waitFor(() => {
            expect(controller.view.locale).toBe('ko');
        });
        expect(world.local.get('hcm:start:lang')).toBe('ko');
    });

    it('badPath_aLanguageWhoseTextsCannotBeFetchedKeepsTheLanguageAndSaysSo', async () => {
        const world = startWorld();
        const controller = new StartController({ ...world.deps, loadTexts: () => Promise.resolve(false) });
        controller.intents.setLocale('vi');
        await vi.waitFor(() => {
            expect(controller.view.notice).toBe('start.languageUnavailable');
        });
        expect(controller.view.locale).toBe('en');
        expect(world.local.get('hcm:start:lang')).toBeUndefined();
    });
});

/** A language file that arrives when the test says so: every request waits for `arrive`. */
function slowFiles(): { readonly load: (locale: string) => Promise<boolean>; readonly arrive: (ok: boolean) => void } {
    const waiting: ((ok: boolean) => void)[] = [];
    return {
        load: () => new Promise<boolean>((resolve) => waiting.push(resolve)),
        arrive: (ok) => {
            waiting.forEach((resolve) => {
                resolve(ok);
            });
        },
    };
}

describe('the start page language switch', () => {
    it('happyPath_aSlowLanguageThenABundledOneEndsInTheBundledOne', async () => {
        const world = startWorld();
        const { load, arrive } = slowFiles();
        const controller = new StartController({ ...world.deps, loadTexts: load });

        controller.intents.setLocale('fr');
        controller.intents.setLocale('ro');
        arrive(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.view.locale).toBe('ro');
        expect(world.local.get('hcm:start:lang')).toBe('ro');
    });

    it('badPath_theBootsFetchArrivingAfterAChoiceNeverUndoesIt', async () => {
        const world = startWorld();
        const { load, arrive } = slowFiles();
        const controller = new StartController({ ...world.deps, search: '?lang=uk', loadTexts: load });
        await controller.start();

        controller.intents.setLocale('en');
        arrive(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.view.locale).toBe('en');
        expect(world.local.get('hcm:start:lang')).toBe('en');
    });

    it('badPath_aSupersededLanguageThatCannotBeFetchedSaysNothing', async () => {
        const world = startWorld();
        const { load, arrive } = slowFiles();
        const controller = new StartController({ ...world.deps, loadTexts: load });

        controller.intents.setLocale('vi');
        controller.intents.setLocale('ro');
        arrive(false);
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.view.notice).toBeNull();
        expect(controller.view.locale).toBe('ro');
    });
});
