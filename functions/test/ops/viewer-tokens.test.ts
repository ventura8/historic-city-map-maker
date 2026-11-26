/**
 * The viewer-token part of `ops.tick`'s `tokens` step (`functions/src/ops/viewer-tokens.ts`; docs/research/M6-interfaces.md
 * §2.6): a city whose viewer token allows other addresses than the server's viewer origins gets a new token minted for them,
 * the old one queued for retirement, and the city written (which republishes its manifest); a refused mint keeps the old
 * token and says why on `setup/status.mapbox`. Mapbox's Tokens API is the scripted fake of `./fakes.ts`; every value is a
 * generated test value.
 */
import { FIRESTORE_PATHS, cityDocSchema, setupStatusDocSchema, type CityDoc, type SetupStatusDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { refreshViewerTokens, type ViewerTokenDeps } from '../../src/ops/viewer-tokens.js';
import { runTick } from '../../src/ops/tick.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { MapboxApi } from '../../src/ports/mapbox-api.js';
import { cityDoc } from '../publish/city.js';
import { TEST_CONFIG } from '../publish/fakes.js';
import { hoursBefore, opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-10-12T09:00:00.000Z';
/** The server's viewer origins since M6: the Hosting site's, and the Pages site's while it stays (§67d). */
const HOSTING = ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com', 'https://ventura8.github.io'];
const PAGES_ONLY = ['https://ventura8.github.io'];

interface Minted {
    readonly user: string;
    readonly note: string;
    readonly allowedUrls: readonly string[];
}

/** The fake Mapbox with a scripted `createToken`: each mint answers the next id, or fails with `refusal`. */
function minting(deps: OpsTestDeps, refusal?: Error): { readonly mapbox: MapboxApi; readonly minted: Minted[] } {
    const minted: Minted[] = [];
    const mapbox: MapboxApi = {
        ...deps.mapbox,
        createToken: (user, _secret, request) => {
            if (refusal !== undefined) {
                return Promise.reject(refusal);
            }
            minted.push({ user, note: request.note, allowedUrls: request.allowedUrls ?? [] });
            const id = `minted${String(minted.length)}`;
            return Promise.resolve({ id, token: `pk.e2e-minted-${id}` });
        },
    };
    return { mapbox, minted };
}

async function world(options: { readonly allowed?: readonly string[] | null; readonly retiring?: number } = {}) {
    const base = opsDeps(NOW);
    const deps: OpsTestDeps = { ...base, config: { ...TEST_CONFIG, viewerOrigins: HOSTING } };
    await deps.secrets.write('mapbox-sk-bootstrap', 'sk.test-bootstrap-value');
    const retiring = Array.from({ length: options.retiring ?? 0 }, (_, index) => ({
        tokenId: `queued${String(index)}`,
        retireAt: hoursBefore(NOW, -1),
    }));
    await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
        mapbox: { state: 'ok', user: 'hcm-test', ...(retiring.length === 0 ? {} : { retiring }) },
        updatedBy: 'u-admin',
        updatedAt: hoursBefore(NOW, 30),
    });
    const allowed = options.allowed === undefined ? PAGES_ONLY : options.allowed;
    const mapbox = {
        publicToken: 'pk.test-viewer-token',
        publicTokenId: 'viewer1',
        ...(allowed === null ? {} : { allowedUrls: [...allowed] }),
    };
    await deps.documents.set(FIRESTORE_PATHS.city('bucuresti'), cityDocSchema, cityDoc({ mapbox }));
    return deps;
}

async function cityOf(deps: OpsTestDeps): Promise<CityDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.city('bucuresti'), cityDocSchema);
}

async function statusOf(deps: OpsTestDeps): Promise<SetupStatusDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema);
}

describe('refreshViewerTokens', () => {
    it('happyPath_aTokenForThePagesOriginIsReplacedByOneForTheServersOrigins @S-A06-HAPPY-VIEWER-ORIGIN', async () => {
        const deps = await world();
        const { mapbox, minted } = minting(deps);

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(1);

        expect(minted).toEqual([{ user: 'hcm-test', note: 'historic-city-map demo-hcm viewer bucuresti (auto)', allowedUrls: HOSTING }]);
        expect((await cityOf(deps))?.mapbox).toEqual({
            publicToken: 'pk.e2e-minted-minted1',
            publicTokenId: 'minted1',
            allowedUrls: HOSTING,
        });
        expect((await cityOf(deps))?.updatedBy).toBe('system:ops');
        // The old token is deleted ten minutes later, so open pages and cached manifests keep working meanwhile.
        expect((await statusOf(deps))?.mapbox?.retiring).toEqual([
            { tokenId: 'viewer1', retireAt: { seconds: Date.parse('2026-10-12T09:10:00.000Z') / 1000, nanoseconds: 0 } },
        ]);
    });

    it('happyPath_theSameOriginsInAnotherOrderAreLeftAlone', async () => {
        const deps = await world({ allowed: [...HOSTING].reverse() });
        const { mapbox, minted } = minting(deps);

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(0);

        expect(minted).toEqual([]);
        expect(deps.mapbox.recorder.calls).toEqual([]);
    });

    it('happyPath_aRemintAfterARefusalClearsWhatTheRefusalSaid', async () => {
        const deps = await world();
        await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
            mapbox: { state: 'ok', user: 'hcm-test', detail: 'apiError.mapbox.mintRefused', params: { scopes: 'x' } },
            updatedBy: 'u-admin',
            updatedAt: hoursBefore(NOW, 30),
        });
        const { mapbox } = minting(deps);

        await refreshViewerTokens({ ...deps, mapbox }, new Date(NOW));

        expect((await statusOf(deps))?.mapbox).toEqual({
            state: 'ok',
            user: 'hcm-test',
            retiring: [expect.objectContaining({ tokenId: 'viewer1' })],
        });
    });

    it('happyPath_theTickRunsItInTheTokensStep', async () => {
        const deps = await world();
        const { mapbox, minted } = minting(deps);

        const steps = await runTick({ ...deps, mapbox });

        expect(steps.find((step) => step.step === 'tokens')).toEqual({ step: 'tokens', ok: true });
        expect(minted).toHaveLength(1);
        expect((await statusOf(deps))?.mapbox?.retiring).toEqual([expect.objectContaining({ tokenId: 'viewer1' })]);
    });

    it('badPath_aRefusedMintKeepsTheOldTokenAndSaysWhy @S-A06-BAD-REMINT-REFUSED', async () => {
        const deps = await world();
        const { mapbox } = minting(deps, new UpstreamError('mapbox', 'forbidden', { status: 403 }));

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).rejects.toMatchObject({
            code: 'apiError.mapbox.mintRefused',
        });

        expect((await cityOf(deps))?.mapbox).toEqual({
            publicToken: 'pk.test-viewer-token',
            publicTokenId: 'viewer1',
            allowedUrls: PAGES_ONLY,
        });
        expect((await statusOf(deps))?.mapbox).toEqual({ state: 'ok', user: 'hcm-test', detail: 'apiError.mapbox.mintRefused' });
    });

    it('badPath_theTickRecordsTheRefusalAndGoesOn', async () => {
        const deps = await world();
        const { mapbox } = minting(deps, new UpstreamError('mapbox', 'invalid', { status: 422 }));

        const steps = await runTick({ ...deps, mapbox });

        expect(steps.find((step) => step.step === 'tokens')).toEqual({ step: 'tokens', ok: false, detail: 'apiError.mapbox.mintRefused' });
        expect(steps.find((step) => step.step === 'invites')).toEqual({ step: 'invites', ok: true });
    });

    it('badPath_withoutMapboxOrWithoutRecordedAddressesNothingIsMinted', async () => {
        const unrecorded = await world({ allowed: null });
        const noSecret = await world();
        await noSecret.secrets.write('mapbox-sk-bootstrap', '');
        const withoutSecret = { ...noSecret, secrets: { ...noSecret.secrets, read: () => Promise.resolve(undefined) } };

        await expect(refreshViewerTokens({ ...unrecorded, mapbox: minting(unrecorded).mapbox }, new Date(NOW))).resolves.toBe(0);
        await expect(refreshViewerTokens({ ...withoutSecret, mapbox: minting(noSecret).mapbox }, new Date(NOW))).resolves.toBe(0);
        expect((await cityOf(noSecret))?.mapbox?.publicTokenId).toBe('viewer1');
    });

    it('badPath_aMapboxAreaWithoutItsAccountMintsNothing', async () => {
        const deps = await world();
        await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
            mapbox: { state: 'missing' },
            updatedBy: 'u-admin',
            updatedAt: hoursBefore(NOW, 30),
        });
        const { mapbox, minted } = minting(deps);

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(0);
        expect(minted).toEqual([]);
    });
});

describe('refreshViewerTokens: what changed while it minted', () => {
    it('badPath_aMapboxAreaRemovedWhileMintingKeepsTheNewTokenAndQueuesNothing', async () => {
        const deps = await world();
        const { mapbox: minter } = minting(deps);
        const mapbox: MapboxApi = {
            ...minter,
            createToken: async (user, secret, request) => {
                // Mapbox disconnected meanwhile (setup.disconnect): the status loses its area.
                await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
                    updatedBy: 'u-admin',
                    updatedAt: hoursBefore(NOW, 1),
                });
                return minter.createToken(user, secret, request);
            },
        };

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(1);

        expect((await cityOf(deps))?.mapbox?.publicTokenId).toBe('minted1');
        expect((await statusOf(deps))?.mapbox).toBeUndefined();
    });

    it('badPath_aCityDeletedWhileMintingIsNotWrittenAgain', async () => {
        const deps = await world();
        const { mapbox: minter } = minting(deps);
        const mapbox: MapboxApi = {
            ...minter,
            createToken: async (user, secret, request) => {
                await deps.documents.delete(FIRESTORE_PATHS.city('bucuresti'));
                return minter.createToken(user, secret, request);
            },
        };

        await refreshViewerTokens({ ...deps, mapbox }, new Date(NOW));

        expect(await cityOf(deps)).toBeUndefined();
        expect((await statusOf(deps))?.mapbox?.retiring).toBeUndefined();
    });

    it('badPath_aFullRetirementQueueWaitsForTheNextTick', async () => {
        const deps = await world({ retiring: 10 });
        const { mapbox, minted } = minting(deps);

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(0);

        expect(minted).toEqual([]);
    });

    it('badPath_aMintFailingWithABugFailsTheStep', async () => {
        const deps = await world();
        const { mapbox } = minting(deps, new Error('bug'));

        await expect(refreshViewerTokens({ ...deps, mapbox }, new Date(NOW))).rejects.toThrow('bug');
    });
});

describe('refreshViewerTokens: a token the city cannot record (finding 3 of the M6 security review)', () => {
    /** A city write that fails, as one whose schema refuses the server's addresses does. */
    function refusingWrites(deps: ViewerTokenDeps): ViewerTokenDeps {
        const transaction: ViewerTokenDeps['documents']['transaction'] = () => Promise.reject(new Error('cityDocSchema: allowedUrls'));
        return { ...deps, documents: { ...deps.documents, transaction } };
    }

    it('badPath_aMintedTokenTheCityCannotHoldIsDeletedAndTheStepFails @S-A06-BAD-UNRECORDED-TOKEN-DELETED', async () => {
        const deps = await world();
        const { mapbox: minter, minted } = minting(deps);
        const failing = refusingWrites({
            ...deps,
            mapbox: { ...minter, deleteToken: (user, secret, tokenId) => deps.mapbox.deleteToken(user, secret, tokenId) },
        });

        await expect(refreshViewerTokens(failing, new Date(NOW))).rejects.toThrow('cityDocSchema');

        expect(minted).toHaveLength(1);
        // Deleted at once: the next tick would otherwise mint another live token every 15 minutes.
        expect(deps.mapbox.recorder.calls).toEqual([{ method: 'deleteToken', args: ['hcm-test', 'minted1'] }]);
        expect((await cityOf(deps))?.mapbox?.publicTokenId).toBe('viewer1');
    });

    it('badPath_aDeletionThatFailsTooIsLoggedAndTheWritesFailureGoesOn', async () => {
        const deps = await world();
        const { mapbox: minter } = minting(deps);
        const deleteToken: MapboxApi['deleteToken'] = () => Promise.reject(new UpstreamError('mapbox', 'unavailable', { status: 503 }));
        const failing = refusingWrites({ ...deps, mapbox: { ...minter, deleteToken } });

        await expect(refreshViewerTokens(failing, new Date(NOW))).rejects.toThrow('cityDocSchema');

        expect(deps.recording.records.map((record) => record.message)).toContain('unrecorded viewer token not deleted');
    });
});
