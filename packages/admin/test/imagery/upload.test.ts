import { RASTER_UPLOAD_MAX_BYTES } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { isTiff, RasterUploader, type ChosenFile, type UploadState } from '../../src/imagery/upload.js';
import { settle } from '../app/fakes.js';
import { imageryWorld, JOBS, jobDoc } from './world.js';

const TIFF = [0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4];

function file(name: string, bytes: readonly number[] = TIFF, size?: number): ChosenFile {
    const blob = new Blob([new Uint8Array(bytes)]);
    return { name, size: size ?? blob.size, slice: (start, end) => blob.slice(start, end) };
}

function uploader(overrides: Parameters<typeof imageryWorld>[0] = {}) {
    const world = imageryWorld(overrides);
    const states: UploadState[] = [];
    const upload = new RasterUploader(world.services, world.uploads, (state) => states.push(state));
    return { ...world, upload, states };
}

describe('the GeoTIFF check', () => {
    it('happyPath_tiffAndBigTiffInBothByteOrdersPassAnythingElseNot', () => {
        const head = (bytes: readonly number[]): Uint8Array => new Uint8Array(bytes);

        expect(
            [head([0x49, 0x49, 0x2a, 0]), head([0x4d, 0x4d, 0, 0x2a]), head([0x49, 0x49, 0x2b, 0]), head([0x4d, 0x4d, 0, 0x2b])].map(
                isTiff,
            ),
        ).toEqual([true, true, true, true]);
        expect(isTiff(head([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    });
});

describe('uploading a GeoTIFF', () => {
    it('happyPath_aNameWithAYearUploadsAtOnceWithItsMetadataAndOpensItsJob', async () => {
        const { upload, uploads, store } = uploader();

        await upload.choose(file('Plan Bucuresti 1911.tif'));
        const sent = uploads.last;
        sent.progress({ sent: 50, total: 200 });
        const halfway = upload.state.progress;
        sent.finish({ ok: true });
        await settle();
        const checking = upload.state.phase;
        store.put(JOBS(upload.state.jobId ?? ''), jobDoc({ type: 'geotiff-import', status: 'queued' }));

        expect(sent.request).toMatchObject({
            contentType: 'image/tiff',
            customMetadata: { originalName: 'Plan Bucuresti 1911.tif', year: '1911' },
        });
        expect(sent.request.path).toMatch(/^uploads\/rasters\/bucharest\/admin-uid\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.tif$/);
        expect([halfway, checking, upload.state.phase]).toEqual([0.25, 'checking', 'done']);
        expect(store.listeners()).toBe(0);
    });

    it('happyPath_aNameWithoutAYearAsksForIt', async () => {
        const { upload, uploads } = uploader();

        await upload.choose(file('scan.tif'));
        const ready = { phase: upload.state.phase, needsYear: upload.state.needsYear };
        upload.start();
        const early = uploads.started.length;
        upload.setYear(' 1966 ');
        upload.start();

        expect([ready, early]).toEqual([{ phase: 'ready', needsYear: true }, 0]);
        expect(uploads.last.request.customMetadata).toEqual({ originalName: 'scan.tif', year: '1966' });
    });

    it('happyPath_aReplacementNamesItsLayerAndAsksNoYear', async () => {
        const { upload, uploads, store } = uploader();

        // The layer keeps its own year: the upload starts at once, whatever the file is called.
        await upload.choose(file('scan.tif'), 'kh-4a-1966');
        const asked = upload.state.needsYear;
        store.put(JOBS(upload.state.jobId ?? ''), jobDoc());
        uploads.last.finish({ ok: true });
        await settle();

        expect(asked).toBe(false);
        expect(uploads.last.request.customMetadata).toEqual({ originalName: 'scan.tif', layerId: 'kh-4a-1966' });
        expect(upload.state).toMatchObject({ phase: 'done', layerId: 'kh-4a-1966' });
    });

    it('badPath_aFileThatIsNoTiffOrTooLargeIsRefusedBeforeAnyUpload', async () => {
        const { upload, uploads } = uploader();

        await upload.choose(file('photo.png', [0x89, 0x50, 0x4e, 0x47]));
        const notTiff = upload.state.refusal;
        await upload.choose(file('huge.tif', TIFF, RASTER_UPLOAD_MAX_BYTES + 1));

        expect([notTiff, upload.state.refusal]).toEqual([
            { key: 'apiError.imagery.notTiff' },
            { key: 'adminContent.imagery.upload.tooLarge' },
        ]);
        expect(upload.state.phase).toBe('refused');
        expect(uploads.started).toHaveLength(0);
    });

    it('badPath_cancelGoesBackToTheChosenFileAndAnInterruptedUploadTriesAgain', async () => {
        const { upload, uploads } = uploader();
        await upload.choose(file('Bucuresti 1966.tif'));

        upload.cancel();
        await settle();
        const cancelled = { phase: upload.state.phase, refusal: upload.state.refusal };
        upload.start();
        uploads.last.finish({ ok: false, reason: 'interrupted' });
        await settle();
        const interrupted = upload.state.refusal;
        upload.start();

        expect(cancelled).toEqual({ phase: 'ready', refusal: { key: 'adminContent.imagery.upload.cancelled' } });
        expect(interrupted).toEqual({ key: 'adminContent.imagery.upload.interrupted' });
        expect(uploads.started).toHaveLength(3);
        expect(upload.state.phase).toBe('uploading');
    });

    it('badPath_anOldUploadsEndAndAWriteAfterAResetChangeNothing', async () => {
        const { upload, uploads, states } = uploader();
        await upload.choose(file('Bucuresti 1966.tif'));
        const first = uploads.last;

        upload.reset();
        first.finish({ ok: true });
        first.progress({ sent: 1, total: 2 });
        await settle();

        expect(upload.state.phase).toBe('idle');
        expect(states.at(-1)?.phase).toBe('idle');
    });

    it('badPath_aJobListenerThatFailsWhileCheckingKeepsWaiting', async () => {
        const { upload, uploads, store } = uploader();
        await upload.choose(file('Bucuresti 1966.tif'));
        uploads.last.finish({ ok: true });
        await settle();

        store.fail(JOBS(upload.state.jobId ?? ''), { kind: 'unavailable', code: 'unavailable' });

        expect(upload.state.phase).toBe('checking');
    });

    it('badPath_signedOutNothingUploads', async () => {
        const { upload, uploads } = uploader({ user: () => null });

        await upload.choose(file('Bucuresti 1966.tif'));

        expect([upload.state.phase, uploads.started.length]).toEqual(['ready', 0]);
    });

    it('badPath_aRefusedUploadSaysItWasRefused', async () => {
        const { upload, uploads } = uploader();
        await upload.choose(file('Bucuresti 1966.tif'));

        uploads.last.finish({ ok: false, reason: 'denied' });
        await settle();

        expect(upload.state).toMatchObject({ phase: 'failed', refusal: { key: 'adminContent.imagery.upload.denied' }, jobId: null });
    });
});
