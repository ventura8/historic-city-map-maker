// Batch upload: each file checked in the page, its photo document created with the sticky fields and the fallback pin,
// three uploads at a time with their progress; once processed, the EXIF suggestions of an untouched photo are applied.
import { describe, expect, it } from 'vitest';

import { PhotoMemory } from '../../src/photos/session.js';
import { UPLOAD_CONCURRENCY, UploadQueue, type UploadItem } from '../../src/photos/upload-queue.js';
import { at, file, photoDoc, photoPath, photosWorld, settle, type PhotosWorld } from './world.js';

const BOUNDS = [
    [26, 44.3],
    [26.3, 44.55],
] as const;

function queueWorld(options: { bounds?: typeof BOUNDS | null; world?: PhotosWorld } = {}) {
    const world = options.world ?? photosWorld();
    const memory = new PhotoMemory(world.services.local);
    const changes: (readonly UploadItem[])[] = [];
    const city = { bounds: options.bounds === undefined ? BOUNDS : options.bounds };
    const queue = new UploadQueue({
        services: world.services,
        memory,
        bounds: () => city.bounds,
        changed: (items) => {
            changes.push(items);
        },
    });
    return { world, memory, queue, changes, city };
}

/** What `photos.onUpload` writes once it has processed the photo. */
function processed(world: PhotosWorld, photoId: string, extra: Record<string, unknown> = {}): void {
    const current = world.store.docs.get(photoPath(photoId)) ?? {};
    world.store.put(photoPath(photoId), {
        ...current,
        processing: 'done',
        image: photoDoc().image,
        updatedBy: 'system:photos',
        updatedAt: at('2026-10-17T12:30:00.000Z'),
        ...extra,
    });
}

describe('UploadQueue: a batch', () => {
    it('happyPath_anUploadersPhotoWaitsForReviewWithNoPlace @S-A90-HAPPY-OWN', async () => {
        const world = photosWorld({ cityRole: () => 'uploader' });
        const { queue } = queueWorld({ world });
        queue.add([file('Calea Victoriei.jpg')]);
        await settle();
        const created = world.store.docs.get(photoPath('new-1'));
        expect(created).toMatchObject({ reviewStatus: 'pending', published: false, createdBy: 'admin-uid' });
        expect(created).not.toHaveProperty('location');
    });

    it('happyPath_eachFileGetsItsPhotoWithTheStickyFieldsAndTheLastPin', async () => {
        const { world, memory, queue } = queueWorld();
        memory.rememberSticky({ author: 'Ion', license: 'CC-BY-4.0' });
        memory.rememberPin([26.12, 44.44]);

        queue.add([file('Calea Victoriei.jpg')]);
        await settle();

        expect(world.store.docs.get(photoPath('new-1'))).toMatchObject({
            title: { ro: 'Calea Victoriei' },
            author: 'Ion',
            license: 'CC-BY-4.0',
            location: { lat: 44.44, lng: 26.12 },
            published: false,
            processing: 'pending',
            createdBy: 'admin-uid',
        });
        expect(world.uploads.at(0).request).toMatchObject({
            path: 'uploads/photos/bucharest/admin-uid/new-1/new-2-photo.jpg',
            customMetadata: { originalName: 'Calea Victoriei.jpg' },
        });
        expect(queue.items[0]).toMatchObject({ phase: 'uploading', photoId: 'new-1' });
        expect(queue.isNew('new-1')).toBe(true);
        expect(queue.busy()).toBe(true);
    });

    it('happyPath_withoutALastPinThePhotoStandsAtTheCitysCentre', async () => {
        const { world, queue } = queueWorld();

        queue.add([file('a.jpg')]);
        await settle();

        expect(world.store.docs.get(photoPath('new-1'))).toMatchObject({ location: { lat: 44.425, lng: 26.15 }, license: 'unknown' });
    });

    it('badPath_aFileDroppedBeforeTheCityIsReadWaitsForItsCentre', async () => {
        const { world, queue, city } = queueWorld({ bounds: null });

        queue.add([file('a.jpg')]);
        await settle();
        const waiting = [world.store.docs.size, queue.items[0]?.phase];
        city.bounds = BOUNDS;
        queue.cityKnown();
        await settle();

        // A photo at no place would be refused by the rules (outside the city): it waits for the city's centre.
        expect(waiting).toEqual([0, 'queued']);
        expect(world.store.docs.get(photoPath('new-1'))).toMatchObject({ location: { lat: 44.425, lng: 26.15 } });
    });

    it('happyPath_threeUploadRunAtOnceTheRestWait', async () => {
        const { world, queue } = queueWorld();

        queue.add(['a', 'b', 'c', 'd'].map((name) => file(`${name}.jpg`)));
        await settle();

        expect(world.uploads.started).toHaveLength(UPLOAD_CONCURRENCY);
        expect(queue.items.map((item) => item.phase)).toEqual(['uploading', 'uploading', 'uploading', 'queued']);
        world.uploads.at(0).progress(30, 120);
        expect(queue.items[0]?.percent).toBe(25);
        world.uploads.at(0).progress(0, 0);
        expect(queue.items[0]?.percent).toBe(0);
        world.uploads.at(0).end({ ok: true });
        await settle();
        expect(world.uploads.started).toHaveLength(4);
        expect(queue.items[0]).toMatchObject({ phase: 'processing', percent: 100 });
    });

    it('badPath_refusedFilesAreListedAndNothingIsWritten', async () => {
        const { world, queue } = queueWorld();

        queue.add([file('big.jpg', 61 * 1024 * 1024), file('scan.pdf')]);
        await settle();

        expect(queue.items.map((item) => [item.phase, item.error])).toEqual([
            ['refused', 'adminContent.photos.tooBig'],
            ['refused', 'apiError.photo.unsupportedType'],
        ]);
        expect(world.store.writes).toEqual([]);
        queue.dismiss(1);
        queue.clearFinished();
        expect(queue.items).toEqual([]);
    });
});

describe('UploadQueue: after processing', () => {
    it('happyPath_theSuggestionsOfAnUntouchedPhotoAreApplied', async () => {
        const { world, queue, memory } = queueWorld();
        queue.add([file('IMG_0001.jpg')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        await settle();

        processed(world, 'new-1', {
            suggested: { location: { lat: 44.44, lng: 26.11 }, year: 1936, bearing: 90, title: 'Calea Victoriei 1936' },
        });
        await settle();

        expect(queue.items[0]?.phase).toBe('done');
        expect(world.store.docs.get(photoPath('new-1'))).toMatchObject({
            title: { ro: 'Calea Victoriei 1936' },
            year: 1936,
            bearing: 90,
            location: { lat: 44.44, lng: 26.11 },
        });
        expect(memory.checkPlace().has('new-1')).toBe(false);
        expect(world.store.listeners(photoPath('new-1'))).toBe(0);
    });

    it('badPath_aPhotoWithoutAPositionIsMarkedCheckThePlace', async () => {
        const { world, queue, memory } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        await settle();

        processed(world, 'new-1');
        await settle();

        expect(memory.checkPlace().has('new-1')).toBe(true);
        expect(world.store.writes.filter((write) => write.kind === 'update')).toEqual([]);
    });

    it('badPath_aTouchedPhotoKeepsWhatTheAdminSet', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        await settle();
        queue.touched('new-1');

        processed(world, 'new-1', { suggested: { year: 1936 } });
        await settle();

        expect(world.store.docs.get(photoPath('new-1'))).not.toHaveProperty('year');
    });

    it('badPath_suggestionsThatCannotBeWrittenAreLogged', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        await settle();
        world.store.outcomes.push({ ok: false, reason: 'conflict' });

        processed(world, 'new-1', { suggested: { year: 1936 } });
        await settle();

        expect(queue.items[0]?.phase).toBe('done');
        expect(world.store.docs.get(photoPath('new-1'))).not.toHaveProperty('year');
    });

    it('badPath_aRefusedFileShowsTheServersReasonAndThePhotoItRepeats', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg'), file('b.heic')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        world.uploads.at(1).end({ ok: true });
        await settle();

        const [first, second] = queue.items.map((item) => item.photoId ?? '');
        processed(world, first ?? '', {
            processing: 'failed',
            image: undefined,
            processingError: 'apiError.photo.duplicate',
            duplicateOf: 'p0',
        });
        processed(world, second ?? '', { processing: 'failed', image: undefined });
        await settle();

        expect(queue.items.map((item) => [item.phase, item.error, item.duplicateOf])).toEqual([
            ['failed', 'apiError.photo.duplicate', 'p0'],
            ['failed', 'apiError.internal', null],
        ]);
    });

    it('badPath_aPhotoDeletedWhileProcessingEndsCancelled', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        await settle();

        world.store.drop(photoPath('new-1'));
        world.store.fail(photoPath('new-1'), { kind: 'failed', code: 'internal' });
        await settle();

        expect(queue.items[0]?.phase).toBe('cancelled');
    });

    it('badPath_aFailedWatchIsLoggedAndTheItemKeepsProcessing', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();
        world.uploads.at(0).end({ ok: true });
        await settle();

        world.store.fail(photoPath('new-1'), { kind: 'denied', code: 'permission-denied' });

        expect(queue.items[0]?.phase).toBe('processing');
    });
});

describe('UploadQueue: interruptions', () => {
    it('badPath_anInterruptedUploadIsRetriedIntoTheSamePhoto', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();

        world.uploads.at(0).end({ ok: false, reason: 'interrupted' });
        await settle();
        expect(queue.items[0]).toMatchObject({ phase: 'interrupted', error: 'adminContent.photos.upload.interrupted' });

        queue.retry(1);
        await settle();
        expect(world.uploads.at(1).request.path).toBe('uploads/photos/bucharest/admin-uid/new-1/new-3-photo.jpg');
        expect([...world.store.docs.keys()].filter((path) => path.includes('/photos/'))).toEqual([photoPath('new-1')]);
    });

    it('badPath_aRefusedUploadFailsAndADeniedOneNamesTheReason', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg'), file('b.jpg')]);
        await settle();

        world.uploads.at(0).end({ ok: false, reason: 'denied' });
        world.uploads.at(1).end({ ok: false, reason: 'failed' });
        await settle();

        expect(queue.items.map((item) => [item.phase, item.error])).toEqual([
            ['failed', 'apiError.notAdmin'],
            ['interrupted', 'adminContent.photos.upload.interrupted'],
        ]);
        queue.retry(99);
        queue.retry(1);
        await settle();
        expect(queue.items[0]?.phase).toBe('uploading');
    });

    it('badPath_aDocumentThatCannotBeCreatedFails', async () => {
        const world = photosWorld();
        world.store.setOffline(true);
        const { queue } = queueWorld({ world });

        queue.add([file('a.jpg')]);
        await settle();

        expect(queue.items[0]).toMatchObject({ phase: 'failed', error: 'adminContent.photos.error.offline', photoId: null });
        expect(world.uploads.started).toEqual([]);
    });

    it('badPath_cancelStopsTheUploadAndRemovesTheNewPhoto', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();

        queue.cancel(1);
        await settle();

        expect(world.uploads.at(0).cancelled).toBe(true);
        expect(queue.items[0]?.phase).toBe('cancelled');
        expect(world.store.docs.has(photoPath('new-1'))).toBe(false);
        expect(queue.isNew('new-1')).toBe(false);
        queue.cancel(1);
        queue.cancel(7);
    });

    it('badPath_cancelWhileThePhotoIsCreatedRemovesItOnceCreated', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);

        queue.cancel(1);
        await settle();

        expect(world.uploads.started).toEqual([]);
        expect(world.store.docs.has(photoPath('new-1'))).toBe(false);
    });

    it('badPath_cancelWhileACreationFailsKeepsCancelled', async () => {
        const world = photosWorld();
        world.store.outcomes.push({ ok: false, reason: 'denied' });
        const { queue } = queueWorld({ world });
        queue.add([file('a.jpg')]);

        queue.cancel(1);
        await settle();

        expect(queue.items[0]?.phase).toBe('cancelled');
    });

    it('badPath_aRemovalThatFailsIsLogged', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();
        world.store.setOffline(true);

        queue.cancel(1);
        await settle();

        expect(world.store.docs.has(photoPath('new-1'))).toBe(true);
    });

    it('badPath_signedOutTheUploadFails', async () => {
        const world = photosWorld({ user: () => null });
        const { queue } = queueWorld({ world });

        queue.add([file('a.jpg')]);
        await settle();

        expect(queue.items[0]).toMatchObject({ phase: 'failed', error: 'apiError.unauthenticated' });
    });

    it('happyPath_destroyCancelsEverything', async () => {
        const { world, queue } = queueWorld();
        queue.add([file('a.jpg')]);
        await settle();

        queue.destroy();

        expect(world.uploads.at(0).cancelled).toBe(true);
        expect(queue.items).toEqual([]);
    });
});
