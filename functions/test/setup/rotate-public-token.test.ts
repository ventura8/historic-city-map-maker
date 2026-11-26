/**
 * `setup.rotatePublicToken` (security review §1.3; scenario A06): the panic button mints a new URL-restricted public
 * token, writes it where its audience reads it, and queues the old one for deletion ten minutes later.
 */
import { FIRESTORE_PATHS, cityDocSchema } from '@hcm/shared';
import { MAPBOX_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import type { DocumentStore } from '../../src/ports/documents.js';
import { rotatePublicToken } from '../../src/setup/rotate-public-token.js';
import { saveMapbox } from '../../src/setup/save-mapbox.js';
import { ADMIN, ADMIN_ORIGINS, CITY, NOW, VIEWER_ORIGINS, cityDoc, createWorld, rejection, type World } from './world.js';

const RETIRE_AT = { seconds: Date.parse(NOW) / 1000 + 600, nanoseconds: 0 };

async function connected(): Promise<World> {
    const world = createWorld();
    await saveMapbox(world.deps, ADMIN, { cityId: CITY, secretToken: MAPBOX_TOKENS.bootstrap });
    return world;
}

function rotate(world: World, audience: 'viewer' | 'admin', cityId = CITY) {
    return rotatePublicToken(world.deps, ADMIN, { cityId, audience });
}

function cityOf(world: World, cityId = CITY) {
    return cityDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.city(cityId)));
}

describe('setup.rotatePublicToken', () => {
    it('happyPath_theViewerGetsANewTokenAndTheOldOneRetiresInTenMinutes', async () => {
        const world = await connected();
        const old = cityOf(world).mapbox?.publicTokenId;

        const response = await rotate(world, 'viewer');

        const minted = world.upstream.state.mapbox.accounts.get('e2e-mapbox')?.tokens.find((token) => token.id === response.tokenId);
        expect(response).toEqual({ tokenId: minted?.id, retiresOldAt: '2026-10-11T08:40:00.000Z', manifestQueued: true });
        expect([minted?.usage, minted?.allowedUrls, minted?.note]).toEqual([
            'pk',
            VIEWER_ORIGINS,
            `historic-city-map demo-hcm viewer ${CITY} (auto)`,
        ]);
        expect(cityOf(world).mapbox).toMatchObject({
            publicToken: minted?.value,
            publicTokenId: minted?.id,
            allowedUrls: VIEWER_ORIGINS,
            user: 'e2e-mapbox',
        });
        expect(world.status()?.mapbox?.retiring).toEqual([{ tokenId: old, retireAt: RETIRE_AT }]);
        expect(world.logged()).not.toContain(String(minted?.value));
    });

    it('happyPath_theAdminTokenIsReplacedInTheSetupStatus', async () => {
        const world = await connected();
        const old = world.status()?.mapbox?.adminTokenId;

        const response = await rotate(world, 'admin');

        expect(response).toMatchObject({ retiresOldAt: '2026-10-11T08:40:00.000Z', manifestQueued: false });
        expect(world.status()?.mapbox).toMatchObject({
            adminTokenId: response.tokenId,
            adminAllowedUrls: ADMIN_ORIGINS,
            retiring: [{ tokenId: old, retireAt: RETIRE_AT }],
        });
        expect(world.status()?.mapbox?.adminToken).toMatch(/^pk\./);
    });

    it('happyPath_anUnpublishedCityQueuesNoManifest', async () => {
        const world = await connected();
        world.documents.seed(FIRESTORE_PATHS.city(CITY), { ...cityOf(world), published: false });

        await expect(rotate(world, 'viewer')).resolves.toMatchObject({ manifestQueued: false });
    });

    it('happyPath_aCityWithoutATokenRetiresNothing', async () => {
        const world = await connected();
        world.documents.seed(FIRESTORE_PATHS.city('cluj'), cityDoc());

        await expect(rotate(world, 'viewer', 'cluj')).resolves.toMatchObject({ retiresOldAt: null });
        expect(world.status()?.mapbox?.retiring).toBeUndefined();
    });

    it('badPath_withoutMapboxThereIsNothingToRotate', async () => {
        const world = createWorld();

        await expect(rejection(rotate(world, 'viewer'))).resolves.toMatchObject({ code: 'apiError.mapbox.notConfigured' });
        expect(world.upstream.callsTo('mapbox')).toEqual([]);
    });

    it('badPath_aBootstrapTokenWithoutItsAccountIsNotConfigured', async () => {
        const world = createWorld();
        await world.deps.secrets.write('mapbox-sk-bootstrap', MAPBOX_TOKENS.bootstrap);

        await expect(rejection(rotate(world, 'admin'))).resolves.toMatchObject({ code: 'apiError.mapbox.notConfigured' });
    });

    it('badPath_aFullRetiringListRefusesAnotherRotation', async () => {
        const world = await connected();
        const status = world.status();
        const retiring = Array.from({ length: 10 }, (_unused, index) => ({ tokenId: `cle2e00old${String(index)}`, retireAt: RETIRE_AT }));
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { ...status, mapbox: { ...status?.mapbox, retiring } });

        await expect(rejection(rotate(world, 'viewer'))).resolves.toMatchObject({ code: 'apiError.rateLimited' });
        expect(world.upstream.callsTo('mapbox.tokens.create')).toHaveLength(3);
    });

    it('badPath_anUnknownCityIsNotFoundBeforeMinting', async () => {
        const world = await connected();

        await expect(rejection(rotate(world, 'viewer', 'nowhere'))).resolves.toMatchObject({ code: 'apiError.notFound' });
        expect(world.upstream.callsTo('mapbox.tokens.create')).toHaveLength(3);
    });

    it('badPath_aDemoAccountRefusesTheMint', async () => {
        const world = await connected();
        await world.deps.secrets.write('mapbox-sk-bootstrap', MAPBOX_TOKENS.trial);
        const status = world.status();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { ...status, mapbox: { ...status?.mapbox, user: 'e2e-mapbox-trial' } });

        await expect(rejection(rotate(world, 'admin'))).resolves.toMatchObject({ code: 'apiError.mapbox.mintRefused' });
    });

    it('badPath_unreadableSecretsAreReported', async () => {
        const world = await connected();
        world.deps.secrets.invalidate();
        world.upstream.fail('secret-manager', 'forbidden');

        await expect(rejection(rotate(world, 'viewer'))).resolves.toMatchObject({ code: 'apiError.secrets.unavailable' });
    });

    it('badPath_mapboxDisconnectedMeanwhileStopsTheRotation', async () => {
        const world = await connected();
        const documents: DocumentStore = {
            ...world.documents,
            transaction: async (work) => {
                await world.documents.delete(FIRESTORE_PATHS.setupStatus);
                return world.documents.transaction(work);
            },
        };

        await expect(
            rejection(rotatePublicToken({ ...world.deps, documents }, ADMIN, { cityId: CITY, audience: 'viewer' })),
        ).resolves.toMatchObject({
            code: 'apiError.mapbox.notConfigured',
        });
    });
});
