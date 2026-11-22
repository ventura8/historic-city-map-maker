/**
 * `imagery.makeLive` (`functions/src/imagery/make-live.ts`, `docs/research/M12-own-tiles.md` §8; S-A231-*; lesson 759): a superseded
 * version whose own tiles are still in the public bucket becomes the layer's live version again, the one that was live reads superseded;
 * a version not superseded, one whose tiles are gone, one whose layer is gone and a caller who is not an editor are refused, and nothing
 * is touched.
 */
import { FIRESTORE_PATHS, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { makeLiveFunction } from '../../src/imagery/make-live.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { fakeAdmins } from '../support/fakes.js';
import { CITY, NOW, at, readLayer, readVersion, readyWorld, renderedVersion, seedLayer, seedVersion, type ImageryWorld } from './world.js';

const LAYER = 'kh-4a-corona-1966';
const OLD = 'job-1966-0712';
const LIVE = 'job-1966-0901';
const OLD_PATH = `public/tiles/${CITY}/${LAYER}/${OLD}.pmtiles`;
const OLD_URL = `https://storage.example/${OLD_PATH}`;
const LIVE_URL = `https://storage.example/public/tiles/${CITY}/${LAYER}/${LIVE}.pmtiles`;

function own(path: string, url: string, removed = false): NonNullable<LayerVersionDoc['own']> {
    return { path, url, bytes: 7, publishedAt: at(NOW), ...(removed ? { removedAt: at(NOW) } : {}) };
}

function withoutOwn(version: LayerVersionDoc): LayerVersionDoc {
    return Object.fromEntries(Object.entries(version).filter(([name]) => name !== 'own')) as LayerVersionDoc;
}

function oldVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({ state: 'superseded', jobId: OLD, own: own(OLD_PATH, OLD_URL), ...overrides });
}

async function world(old: LayerVersionDoc = oldVersion(), stored = true): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedVersion(ready, OLD, old);
    await seedVersion(ready, LIVE, renderedVersion({ state: 'published', jobId: LIVE, own: own('x', LIVE_URL) }));
    await seedLayer(ready, LAYER, { source: { type: 'pmtiles', url: LIVE_URL }, currentVersion: LIVE });
    if (stored) {
        ready.deps.blobs.put('public', OLD_PATH, new Uint8Array([1]));
    }
    return ready;
}

function makeLive(target: ImageryWorld, deps = target.deps) {
    return makeLiveFunction(() => deps).run(adminCall({ cityId: CITY, versionId: OLD }));
}

async function expectUntouched(target: ImageryWorld, state: LayerVersionDoc['state'] = 'superseded'): Promise<void> {
    expect((await readVersion(target, OLD))?.state).toBe(state);
    expect((await readVersion(target, LIVE))?.state).toBe('published');
    expect(await readLayer(target, LAYER)).toMatchObject({ source: { url: LIVE_URL }, currentVersion: LIVE });
}

describe('imagery.makeLive', () => {
    it('happyPath_aSupersededVersionWithItsTilesBecomesLiveAgain @S-A231-HAPPY-MAKE-LIVE', async () => {
        const target = await world();

        await expect(makeLive(target)).resolves.toEqual({ live: true });

        expect(await readLayer(target, LAYER)).toMatchObject({
            source: { type: 'pmtiles', url: OLD_URL },
            currentVersion: OLD,
            status: 'ready',
            updatedBy: 'u-admin',
        });
        expect(await readVersion(target, OLD)).toMatchObject({ state: 'published', updatedBy: 'u-admin' });
        expect(await readVersion(target, LIVE)).toMatchObject({ state: 'superseded', updatedBy: 'u-admin' });
    });

    it('happyPath_aLayerWhoseLiveVersionIsGoneStillTakesIt @S-A231-HAPPY-MAKE-LIVE', async () => {
        const target = await world();
        await seedLayer(target, LAYER, { source: { type: 'pmtiles', url: LIVE_URL }, currentVersion: 'job-gone' });

        await expect(makeLive(target)).resolves.toEqual({ live: true });

        expect(await readLayer(target, LAYER)).toMatchObject({ currentVersion: OLD });
    });

    it('happyPath_aLayerWithNoCurrentVersionTakesIt @S-A231-HAPPY-MAKE-LIVE', async () => {
        const target = await world();
        await seedLayer(target, LAYER, { source: { type: 'pmtiles', url: LIVE_URL } });

        await expect(makeLive(target)).resolves.toEqual({ live: true });

        expect(await readLayer(target, LAYER)).toMatchObject({ currentVersion: OLD, source: { url: OLD_URL } });
        expect((await readVersion(target, LIVE))?.state).toBe('published');
    });

    it.each<[string, LayerVersionDoc, boolean]>([
        ['removed after the grace', oldVersion({ own: own(OLD_PATH, OLD_URL, true) }), true],
        ['missing from the bucket', oldVersion(), false],
        ['published through Mapbox', { ...withoutOwn(oldVersion()), mapbox: { tilesetId: 'e2e-mapbox.x', origin: 'mts' } }, true],
    ])('badPath_tiles%sAreRefused @S-A231-BAD-TILES-GONE', async (_name, version, stored) => {
        const target = await world(version, stored);

        await expect(failureOf(makeLive(target))).resolves.toMatchObject({ details: { code: 'apiError.imagery.liveTilesGone' } });
        await expectUntouched(target);
    });

    it('badPath_aVersionNotSupersededIsAVersionState @S-A231-BAD-TILES-GONE', async () => {
        const target = await world(oldVersion({ state: 'rejected' }));

        await expect(failureOf(makeLive(target))).resolves.toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        await expectUntouched(target, 'rejected');
    });

    it('badPath_aVersionPublishedMeanwhileIsAVersionState @S-A231-BAD-TILES-GONE', async () => {
        const target = await world();
        const store = target.deps.documents;
        const transaction: typeof store.transaction = async (work) => {
            await seedVersion(target, OLD, oldVersion({ state: 'published' }));
            return store.transaction(work);
        };

        await expect(failureOf(makeLive(target, { ...target.deps, documents: { ...store, transaction } }))).resolves.toMatchObject({
            details: { code: 'apiError.imagery.versionState' },
        });
        expect(await readLayer(target, LAYER)).toMatchObject({ currentVersion: LIVE });
    });

    it('badPath_aVersionWhoseLayerIsGoneIsNotFound @S-A231-BAD-TILES-GONE', async () => {
        const target = await world();
        await target.deps.documents.delete(FIRESTORE_PATHS.layer(CITY, LAYER));

        await expect(failureOf(makeLive(target))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
        expect((await readVersion(target, OLD))?.state).toBe('superseded');
    });

    it('badPath_anUnknownVersionIsNotFound @S-A231-BAD-TILES-GONE', async () => {
        const target = await readyWorld();

        await expect(failureOf(makeLive(target))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it.each<['moderator' | 'uploader']>([['moderator'], ['uploader']])('badPath_a%sCannotMakeLive @S-A231-BAD-TILES-GONE', async (role) => {
        const target = await world();
        const admins = fakeAdmins(['u-admin'], { projectRole: 'admin', cities: { [CITY]: role } });

        await expect(failureOf(makeLive(target, { ...target.deps, admins }))).resolves.toMatchObject({
            details: { code: 'apiError.city.notEditor' },
        });
        await expectUntouched(target);
    });
});
