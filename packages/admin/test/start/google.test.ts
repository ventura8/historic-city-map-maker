/** The start page's REST calls against the fake Google (`docs/research/M14-start-your-map.md` §1), what its answers come to. */
import { createUpstreamFakes, GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import { createGoogleTransport, type GoogleTransport } from '../../src/google/transport.js';
import { createStartGoogle, type StartGoogle } from '../../src/start/google.js';
import { testLog } from '../app/fakes.js';

const PROJECT = 'fostul-bacau';

function world(): { readonly google: StartGoogle; readonly fakes: ReturnType<typeof createUpstreamFakes> } {
    const fakes = createUpstreamFakes();
    fakes.scenario('firebase-hosting.fresh');
    const google = createStartGoogle(
        createGoogleTransport({ fetch: fakes.fetch, token: () => GOOGLE_TOKENS.owner, sleep: () => Promise.resolve(), log: testLog().log }),
    );
    return { google, fakes };
}

describe('the start page and Google', () => {
    it('happyPath_aProjectIsMadeOnceThenFoundAndListed', async () => {
        const { google } = world();
        // Google's rule (AIP-193): the same 403 whether the project exists or not, never a 404 that says it is free.
        await expect(google.getProject(PROJECT)).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
        await expect(google.getProject(PROJECT)).rejects.toBeInstanceOf(GoogleApiError);
        expect(await google.listProjects()).toEqual([]);
        await google.createProject(PROJECT, 'Fostul Bacau');
        expect(await google.getProject(PROJECT)).toMatchObject({ projectId: PROJECT });
        expect(await google.listProjects()).toMatchObject([{ projectId: PROJECT, displayName: 'Fostul Bacau' }]);
    });

    it('badPath_createAnswersWhatGoogleDocuments', async () => {
        const { google, fakes } = world();
        await expect(google.createProject(PROJECT, 'Sf. Gheorghe')).rejects.toMatchObject({ kind: 'invalid', status: 400 });
        await google.createProject(PROJECT, 'Fostul Bacau');
        await expect(google.createProject(PROJECT, 'Fostul Bacau')).rejects.toMatchObject({ kind: 'conflict', status: 409 });
        fakes.scenario('firebase-hosting.projectRefused');
        await expect(google.createProject('alt-proiect', 'Fostul Bacau')).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('happyPath_whatIsLiveAndItsLabel', async () => {
        const { google } = world();
        await google.createProject(PROJECT, 'Fostul Bacau');
        await google.addFirebase(PROJECT);
        const site = (await google.defaultSite(PROJECT)) ?? '';
        expect(await google.liveRelease(site)).toBeNull();
        const version = await google.createVersion(site, {}, { 'hcm-start-release': 'r1' });
        await google.populate(version, {});
        await google.finalize(version);
        await google.release(site, version);
        expect(await google.liveRelease(site)).toEqual({ label: 'r1' });
        const other = await google.createVersion(site, {}, {});
        await google.populate(other, {});
        await google.finalize(other);
        await google.release(site, other);
        expect(await google.liveRelease(site)).toEqual({ label: null });
    });

    it('edge_anAnswerWithoutItsFields', async () => {
        const google = createStartGoogle({
            find: () => Promise.resolve(undefined),
            call: () => Promise.resolve({}),
        } as unknown as GoogleTransport);
        expect(await google.getProject(PROJECT)).toBeNull();
        expect(await google.liveRelease(PROJECT)).toBeNull();
        expect(await google.createVersion(PROJECT, {})).toBe('');
        const namedless = createStartGoogle({
            find: () => Promise.resolve({ sites: [{ type: 'DEFAULT_SITE' }] }),
        } as unknown as GoogleTransport);
        expect(await namedless.defaultSite(PROJECT)).toBe('');
    });

    it('happyPath_firebaseItsAppAndItsSite', async () => {
        const { google } = world();
        expect(await google.hasFirebase(PROJECT)).toBe(false);
        expect(await google.hasWebApp(PROJECT)).toBe(false);
        expect(await google.defaultSite(PROJECT)).toBeNull();
        await google.addFirebase(PROJECT);
        await google.createWebApp(PROJECT, 'Fostul Bacau');
        expect(await google.hasFirebase(PROJECT)).toBe(true);
        expect(await google.hasWebApp(PROJECT)).toBe(true);
        expect(await google.defaultSite(PROJECT)).toBe(PROJECT);
        expect(await google.createSite('other-project')).toBe('other-project');
    });

    it('happyPath_aVersionIsPopulatedFinalizedAndReleased', async () => {
        const { google, fakes } = world();
        const version = await google.createVersion(PROJECT, { cleanUrls: true });
        const answer = await google.populate(version, { '/index.html': 'a'.repeat(64) });
        expect(answer.required).toEqual(['a'.repeat(64)]);
        expect(answer.uploadUrl).toContain('upload-firebasehosting.googleapis.com');
        await expect(google.finalize(version)).rejects.toMatchObject({ kind: 'invalid' });
        fakes.state.startWorld.hashes.add('a'.repeat(64));
        expect((await google.populate(version, { '/index.html': 'a'.repeat(64) })).required).toEqual([]);
        await google.finalize(version);
        await google.release(PROJECT, version);
        expect(fakes.state.startWorld.live.get(PROJECT)).toBe(version);
    });

    it('badPath_aReleaseOfAnUnfinishedVersionAndARuleGoogleDoesNotKnow', async () => {
        const { google } = world();
        const version = await google.createVersion(PROJECT, {});
        await expect(google.release(PROJECT, version)).rejects.toMatchObject({ kind: 'invalid' });
        await expect(google.createVersion(PROJECT, { source: 'x' } as never)).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('happyPath_googleSignInIsReadFromTheProvider', async () => {
        const { google, fakes } = world();
        expect(await google.googleSignInOn(PROJECT)).toBe(false);
        fakes.scenario('firebase-hosting.googleSignInOn');
        expect(await google.googleSignInOn(PROJECT)).toBe(true);
    });
});
