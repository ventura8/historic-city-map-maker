/**
 * The admin-token part of `ops.tick`'s `tokens` step (`functions/src/ops/admin-token.ts`; DECISIONS-for-review.md §210):
 * an admin token whose recorded addresses are not the server's admin origins (the admin's own site added) is replaced by
 * one minted for them, the old one queued for retirement. Mapbox's Tokens API is the scripted fake of `./fakes.ts`; every
 * value is a generated test value.
 */
import { FIRESTORE_PATHS, setupStatusDocSchema, type SetupStatusDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { refreshAdminToken } from '../../src/ops/admin-token.js';
import { runTick } from '../../src/ops/tick.js';
import type { MapboxApi } from '../../src/ports/mapbox-api.js';
import { TEST_CONFIG } from '../publish/fakes.js';
import { hoursBefore, opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-11-13T09:00:00.000Z';
const PUBLIC_MAP = ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'];
const WITH_ADMIN_SITE = [...PUBLIC_MAP, 'https://demo-hcm-admin.web.app', 'https://demo-hcm-admin.firebaseapp.com'];

interface Minted {
    readonly note: string;
    readonly allowedUrls: readonly string[];
}

function minting(deps: OpsTestDeps, refusal?: Error): { readonly mapbox: MapboxApi; readonly minted: Minted[] } {
    const minted: Minted[] = [];
    const mapbox: MapboxApi = {
        ...deps.mapbox,
        createToken: (_user, _secret, request) => {
            if (refusal !== undefined) {
                return Promise.reject(refusal);
            }
            minted.push({ note: request.note, allowedUrls: request.allowedUrls ?? [] });
            return Promise.resolve({ id: 'admin2', token: 'pk.e2e-minted-admin2' });
        },
    };
    return { mapbox, minted };
}

async function world(mapbox: Partial<NonNullable<SetupStatusDoc['mapbox']>> = {}, secret = true): Promise<OpsTestDeps> {
    const base = opsDeps(NOW);
    const deps: OpsTestDeps = { ...base, config: { ...TEST_CONFIG, adminOrigins: WITH_ADMIN_SITE } };
    if (secret) {
        await deps.secrets.write('mapbox-sk-bootstrap', 'sk.test-bootstrap-value');
    }
    await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
        mapbox: {
            state: 'ok',
            user: 'hcm-test',
            adminToken: 'pk.test-admin-token',
            adminTokenId: 'admin1',
            adminAllowedUrls: PUBLIC_MAP,
            ...mapbox,
        },
        updatedBy: 'u-admin',
        updatedAt: hoursBefore(NOW, 30),
    });
    return deps;
}

async function mapboxOf(deps: OpsTestDeps) {
    return (await deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema))?.mapbox;
}

describe('refreshAdminToken', () => {
    it('happyPath_aTokenForThePublicMapsOriginsIsReplacedByOneThatAllowsTheAdminsOwnSite @S-A160-HAPPY-ADMIN-TOKEN', async () => {
        const deps = await world();
        const { mapbox, minted } = minting(deps);

        await expect(refreshAdminToken({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(true);

        expect(minted).toEqual([{ note: 'historic-city-map demo-hcm admin (auto)', allowedUrls: WITH_ADMIN_SITE }]);
        expect(await mapboxOf(deps)).toMatchObject({
            adminToken: 'pk.e2e-minted-admin2',
            adminTokenId: 'admin2',
            adminAllowedUrls: WITH_ADMIN_SITE,
            retiring: [{ tokenId: 'admin1', retireAt: { seconds: Date.parse('2026-11-13T09:10:00.000Z') / 1000, nanoseconds: 0 } }],
        });
    });

    it('happyPath_theTickRunsItInTheTokensStep', async () => {
        const deps = await world();
        const { mapbox, minted } = minting(deps);

        const steps = await runTick({ ...deps, mapbox });

        expect(steps.find((step) => step.step === 'tokens')).toEqual({ step: 'tokens', ok: true });
        expect(minted).toHaveLength(1);
    });

    it('badPath_theSameOriginsUnrecordedOnesOrNoMapboxMintNothing', async () => {
        for (const deps of [
            await world({ adminAllowedUrls: [...WITH_ADMIN_SITE].reverse() }),
            await world({ adminAllowedUrls: undefined }),
            await world({}, false),
            await world({
                retiring: Array.from({ length: 10 }, (_, index) => ({ tokenId: `q${String(index)}`, retireAt: hoursBefore(NOW, -1) })),
            }),
        ]) {
            const { mapbox, minted } = minting(deps);
            await expect(refreshAdminToken({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(false);
            expect(minted).toEqual([]);
        }
    });

    it('badPath_aRefusedMintKeepsTheOldTokenForTheNextTick @S-A160-BAD-ADMIN-TOKEN-REFUSED', async () => {
        const deps = await world();
        const { mapbox } = minting(deps, new Error('forbidden'));

        await expect(refreshAdminToken({ ...deps, mapbox }, new Date(NOW))).resolves.toBe(false);

        expect(await mapboxOf(deps)).toMatchObject({ adminTokenId: 'admin1', adminAllowedUrls: PUBLIC_MAP });
    });
});
