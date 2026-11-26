/** The deploy's edges over a hand-made Google: a site that takes time, a project not found, an upload refused. */
import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import { deployStart, type DeployDeps, type DeployPlan } from '../../src/start/deploy.js';
import type { StartGoogle } from '../../src/start/google.js';
import { BASE, PLAIN, releaseOf, sha, SLUG } from './fakes.js';

const PLAN: DeployPlan = { projectId: 'my-project', displayName: 'My project', create: true, city: { id: 'bacau', name: { ro: 'Bacău' } } };

function google(overrides: Partial<StartGoogle> = {}): StartGoogle {
    return {
        listProjects: () => Promise.resolve([]),
        getProject: () => Promise.resolve({ projectId: 'my-project', displayName: 'x', projectNumber: '1' }),
        createProject: () => Promise.resolve(),
        hasFirebase: () => Promise.resolve(true),
        addFirebase: () => Promise.resolve(),
        hasWebApp: () => Promise.resolve(true),
        createWebApp: () => Promise.resolve(),
        defaultSite: () => Promise.resolve('my-project'),
        createSite: () => Promise.resolve('made'),
        createVersion: () => Promise.resolve('sites/s/versions/v'),
        populate: (_version, files) =>
            Promise.resolve({ required: [...Object.values(files), 'unknown-hash'], uploadUrl: 'https://upload.example/files' }),
        finalize: () => Promise.resolve(),
        release: () => Promise.resolve(),
        googleSignInOn: () => Promise.resolve(true),
        liveRelease: () => Promise.resolve(null),
        ...overrides,
    };
}

const urlOf = (input: RequestInfo | URL): string => new Request(input).url;

function depsOf(answer: () => Promise<Response>, api: StartGoogle = google()): DeployDeps {
    return {
        google: api,
        tools: {
            fetch: (input) => (urlOf(input).startsWith(BASE) ? Promise.resolve(new Response(PLAIN as Uint8Array<ArrayBuffer>)) : answer()),
            digest: (bytes) => Promise.resolve(sha(bytes)),
            gzip: (bytes) => Promise.resolve(bytes),
        },
        clock: {
            setTimeout: (run: () => void) => {
                run();
                return 0;
            },
        },
        baseUrl: BASE,
        release: releaseOf({ slug: SLUG, files: [{ path: 'index.html', bytes: PLAIN.length, sha256: sha(PLAIN) }] }),
        onStep: () => undefined,
        onFiles: () => undefined,
    };
}

const OK = (): Promise<Response> => Promise.resolve(new Response('{}'));
const TOKEN = (): string => 'token';

describe('deployStart', () => {
    it('happyPath_aSiteThatNeverAppearsIsMadeAndWhatExistsIsLeft', async () => {
        let looks = 0;
        const made: string[] = [];
        const api = google({
            defaultSite: () => {
                looks += 1;
                return Promise.resolve(null);
            },
            createSite: (project) => {
                made.push(project);
                return Promise.resolve(project);
            },
            createProject: () => Promise.reject(new Error('must not be made')),
        });
        await deployStart(depsOf(OK, api), PLAN, TOKEN);
        expect(looks).toBe(6);
        expect(made).toEqual(['my-project']);
    });

    it('happyPath_whatLacksIsMade', async () => {
        const made: string[] = [];
        const record = (name: string) => (): Promise<void> => {
            made.push(name);
            return Promise.resolve();
        };
        let found = false;
        const api = google({
            getProject: () => {
                const answer = found ? { projectId: 'my-project', displayName: 'x', projectNumber: '1' } : null;
                found = true;
                return Promise.resolve(answer);
            },
            createProject: record('project'),
            hasFirebase: () => Promise.resolve(false),
            addFirebase: record('firebase'),
            hasWebApp: () => Promise.resolve(false),
            createWebApp: record('webApp'),
        });
        await deployStart(depsOf(OK, api), PLAN, () => null);
        expect(made).toEqual(['project', 'firebase', 'webApp']);
    });

    it('badPath_aPickedProjectTheOwnerCannotSeeIsRefused', async () => {
        const api = google({ getProject: () => Promise.resolve(null) });
        await expect(deployStart(depsOf(OK, api), { ...PLAN, create: false }, TOKEN)).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('edge_aMadeProjectStillUnreadableHasNoNumberYet', async () => {
        const api = google({ getProject: () => Promise.resolve(null) });
        await expect(deployStart(depsOf(OK, api), PLAN, TOKEN)).resolves.toBeUndefined();
    });

    it('badPath_googleAnswers403ForAProjectNobodyCanSee_soTheCreateStillRuns', async () => {
        const made: string[] = [];
        let looks = 0;
        const api = google({
            getProject: () => {
                looks += 1;
                return looks === 1
                    ? Promise.reject(new GoogleApiError('resource-manager.getProject', { kind: 'forbidden', status: 403 }))
                    : Promise.resolve({ projectId: 'my-project', displayName: 'x', projectNumber: '7' });
            },
            createProject: (project) => {
                made.push(project);
                return Promise.resolve();
            },
        });
        await deployStart(depsOf(OK, api), PLAN, TOKEN);
        expect(made).toEqual(['my-project']);
    });

    it('badPath_aTakenIdAnswers403ThenAConflict', async () => {
        const api = google({
            getProject: () => Promise.reject(new GoogleApiError('resource-manager.getProject', { kind: 'forbidden', status: 403 })),
            createProject: () => Promise.reject(new GoogleApiError('resource-manager.createProject', { kind: 'conflict', status: 409 })),
        });
        await expect(deployStart(depsOf(OK, api), PLAN, TOKEN)).rejects.toMatchObject({ kind: 'conflict' });
    });

    it('badPath_a403OnAPickedProjectStaysARefusal', async () => {
        const api = google({
            getProject: () => Promise.reject(new GoogleApiError('resource-manager.getProject', { kind: 'forbidden', status: 403 })),
            createProject: () => Promise.reject(new Error('must not be made')),
        });
        await expect(deployStart(depsOf(OK, api), { ...PLAN, create: false }, TOKEN)).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('badPath_aReadThatFailsOtherwiseStops', async () => {
        const api = google({
            getProject: () => Promise.reject(new GoogleApiError('resource-manager.getProject', { kind: 'unavailable', status: 503 })),
        });
        await expect(deployStart(depsOf(OK, api), PLAN, TOKEN)).rejects.toMatchObject({ kind: 'unavailable' });
    });

    it.each([
        [401, 'unauthorized'],
        [500, 'unavailable'],
    ])('badPath_anUploadAnswered_%i', async (status, kind) => {
        const refused = (): Promise<Response> => Promise.resolve(new Response('', { status }));
        await expect(deployStart(depsOf(refused), PLAN, TOKEN)).rejects.toBeInstanceOf(GoogleApiError);
        await expect(deployStart(depsOf(refused), PLAN, TOKEN)).rejects.toMatchObject({ kind });
    });
});

describe('what is live already (M14 §7)', () => {
    function recording(live: { readonly label: string | null } | null): { api: StartGoogle; released: string[] } {
        const released: string[] = [];
        const api = google({
            liveRelease: () => Promise.resolve(live),
            release: (_site, version) => {
                released.push(version);
                return Promise.resolve();
            },
        });
        return { api, released };
    }

    it('happyPath_aSiteWithNothingLiveGetsTheRelease_labelledWithIt', async () => {
        const { api, released } = recording(null);
        const labels: unknown[] = [];
        const labelling = {
            ...api,
            createVersion: (site: string, config: never, label: unknown) => {
                labels.push(label);
                return api.createVersion(site, config, label as never);
            },
        };
        await deployStart(depsOf(OK, labelling), PLAN, TOKEN);
        expect(released).toHaveLength(1);
        expect(labels).toEqual([{ 'hcm-start-release': SLUG }]);
    });

    it('badPath_thisReleaseLiveIsNotReleasedAgain', async () => {
        const { api, released } = recording({ label: SLUG });
        const steps: string[] = [];
        await deployStart({ ...depsOf(OK, api), onStep: (step) => steps.push(step) }, { ...PLAN, create: false }, TOKEN);
        expect(released).toEqual([]);
        expect(steps.at(-1)).toBe('release');
        expect(steps).not.toContain('files');
    });

    it('badPath_aPublishedSiteOnAProjectThisOwnerMadeIsLeftAlone', async () => {
        const { api, released } = recording({ label: null });
        await deployStart(depsOf(OK, api), PLAN, TOKEN);
        expect(released).toEqual([]);
    });

    it('happyPath_aPickedProjectsOtherSiteIsReplaced_asThePageWarned', async () => {
        const { api, released } = recording({ label: null });
        await deployStart(depsOf(OK, api), { ...PLAN, create: false }, TOKEN);
        expect(released).toHaveLength(1);
    });
});
