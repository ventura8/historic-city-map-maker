// Bulk actions: each photo checked first, the ones that cannot change listed with their reason, the rest batched.
import type { PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { planFor, runBulk } from '../../src/photos/bulk.js';
import type { Stored } from '../../src/content/services.js';
import { CITY, photoDoc, photoPath, photosWorld, seedPhoto } from './world.js';

function stored(id: string, overrides: Partial<PhotoDoc> = {}): Stored<PhotoDoc> {
    return { id, path: photoPath(id), data: photoDoc(overrides), version: 'v1', pending: false };
}

describe('planFor', () => {
    const path = photoPath('p1');

    it('happyPath_publishWritesPublishedOrNothingWhenAlreadySo', () => {
        expect(planFor({ kind: 'publish' }, stored('p1'), path, false)).toEqual({
            write: { kind: 'update', path, fields: { published: true } },
        });
        expect(planFor({ kind: 'publish' }, stored('p1', { published: true }), path, false)).toEqual({ write: null });
    });

    it('badPath_publishSkipsWhatCannotBePublished', () => {
        expect(planFor({ kind: 'publish' }, stored('p1', { license: 'unknown' }), path, false)).toEqual({ skip: 'license' });
        expect(planFor({ kind: 'publish' }, stored('p1'), path, true)).toEqual({ skip: 'place' });
    });

    it('happyPath_unpublishAndConfirmRights', () => {
        expect(planFor({ kind: 'unpublish' }, stored('p1', { published: true }), path, false)).toEqual({
            write: { kind: 'update', path, fields: { published: false } },
        });
        expect(planFor({ kind: 'unpublish' }, stored('p1'), path, false)).toEqual({ write: null });
        expect(planFor({ kind: 'confirmRights' }, stored('p1', { rightsReview: true }), path, false)).toEqual({
            write: { kind: 'update', path, fields: { rightsReview: false } },
        });
        expect(planFor({ kind: 'confirmRights' }, stored('p1'), path, false)).toEqual({ write: null });
    });

    it('happyPath_setFieldsWritesOnlyTheChosenFields', () => {
        expect(planFor({ kind: 'setFields', fields: { author: 'Ion', sourceUrl: undefined } }, stored('p1'), path, false)).toEqual({
            write: { kind: 'update', path, fields: { author: 'Ion' } },
        });
    });

    it('badPath_setFieldsRefusesAnUnknownLicenceOnAPublishedPhotoAndAnInvalidValue', () => {
        expect(planFor({ kind: 'setFields', fields: { license: 'unknown' } }, stored('p1', { published: true }), path, false)).toEqual({
            skip: 'license',
        });
        expect(planFor({ kind: 'setFields', fields: { sourceUrl: 'http://insecure.example' } }, stored('p1'), path, false)).toEqual({
            skip: 'sourceUrl',
        });
        expect(planFor({ kind: 'setFields', fields: { author: 'x'.repeat(201) } }, stored('p1'), path, false)).toEqual({ skip: 'invalid' });
    });

    it('happyPath_deleteIsADelete', () => {
        expect(planFor({ kind: 'delete' }, stored('p1'), path, false)).toEqual({ write: { kind: 'delete', path } });
    });
});

describe('runBulk', () => {
    it('badPath_photosThatCannotBePublishedAreListedAndTheRestPublished', async () => {
        const world = photosWorld();
        seedPhoto(world, 'ok');
        seedPhoto(world, 'processing', { processing: 'pending', image: undefined });
        seedPhoto(world, 'failed', { processing: 'failed', image: undefined });
        seedPhoto(world, 'unknown', { license: 'unknown' });
        const photos = ['ok', 'processing', 'failed', 'unknown'].map((id) =>
            stored(id, world.store.docs.get(photoPath(id)) as Partial<PhotoDoc>),
        );

        const report = await runBulk({ store: world.store, cityId: CITY, checkPlace: () => false }, { kind: 'publish' }, photos);

        expect(report).toEqual({
            kind: 'publish',
            done: 1,
            skipped: [
                { id: 'processing', title: 'Calea Victoriei', reason: 'processing' },
                { id: 'failed', title: 'Calea Victoriei', reason: 'failed' },
                { id: 'unknown', title: 'Calea Victoriei', reason: 'license' },
            ],
        });
        expect(world.store.docs.get(photoPath('ok'))).toMatchObject({ published: true });
    });

    it('happyPath_aLargeSelectionIsWrittenInBatchesOf500', async () => {
        const world = photosWorld();
        const photos = Array.from({ length: 501 }, (_value, index) => stored(`p${String(index)}`, { published: true }));

        const report = await runBulk({ store: world.store, cityId: CITY, checkPlace: () => false }, { kind: 'unpublish' }, photos);

        expect(report.done).toBe(501);
        expect(world.store.writes.map((write) => (write.kind === 'batch' ? write.writes.length : 0))).toEqual([500, 1]);
    });

    it('badPath_aRefusedBatchReportsEachOfItsPhotos', async () => {
        const world = photosWorld();
        world.store.outcomes.push({ ok: false, reason: 'offline' });

        const report = await runBulk({ store: world.store, cityId: CITY, checkPlace: () => false }, { kind: 'delete' }, [
            stored('a'),
            stored('b'),
        ]);

        expect(report).toEqual({
            kind: 'delete',
            done: 0,
            skipped: [
                { id: 'a', title: 'Calea Victoriei', reason: 'offline' },
                { id: 'b', title: 'Calea Victoriei', reason: 'offline' },
            ],
        });
    });

    it('happyPath_photosAlreadyAsAskedCountAsDone', async () => {
        const world = photosWorld();

        const report = await runBulk({ store: world.store, cityId: CITY, checkPlace: () => false }, { kind: 'confirmRights' }, [
            stored('a'),
        ]);

        expect(report).toEqual({ kind: 'confirmRights', done: 1, skipped: [] });
        expect(world.store.writes).toEqual([]);
    });
});
