// Replace image: the file goes into the photo's folder, nothing is written to the document; the server's write says
// whether the image was swapped, was the same, or the new file was refused (the old image stays).
import type { PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { Stored } from '../../src/content/services.js';
import { PhotoReplacement, type ReplaceState } from '../../src/photos/replace.js';
import { at, file, photoDoc, photoPath, photosWorld, settle } from './world.js';

function stored(overrides: Partial<PhotoDoc> = {}, version = 'v1'): Stored<PhotoDoc> {
    return { id: 'p1', path: photoPath('p1'), data: photoDoc(overrides), version, pending: false };
}

function replacementWorld(user: { uid: string; name: string } | null = { uid: 'admin-uid', name: 'Ana' }) {
    const world = photosWorld({ user: () => user });
    const states: (ReplaceState | null)[] = [];
    const replacement = new PhotoReplacement({
        services: world.services,
        changed: (state) => {
            states.push(state);
        },
    });
    return { world, replacement, states };
}

const SERVER = { updatedBy: 'system:photos' } as const;

describe('PhotoReplacement', () => {
    it('happyPath_theNewImageReplacesTheOldInOneServerWrite', async () => {
        const { world, replacement } = replacementWorld();
        replacement.start(stored(), file('new.jpg'));
        const upload = world.uploads.at(0);
        expect(upload.request).toMatchObject({
            path: 'uploads/photos/bucharest/admin-uid/p1/new-1-photo.jpg',
            contentType: 'image/jpeg',
            customMetadata: { originalName: 'new.jpg' },
        });

        upload.progress(50, 100);
        expect(replacement.state).toMatchObject({ phase: 'uploading', percent: 50 });
        upload.end({ ok: true });
        await settle();
        expect(replacement.state?.phase).toBe('processing');

        replacement.snapshot(
            stored({ ...SERVER, image: { web: 'https://x/w.webp', thumb: 'https://x/t.webp', w: 1, h: 1, sha256: 'b'.repeat(64) } }, 'v2'),
        );

        expect(replacement.state).toEqual({ phase: 'replaced', percent: 100, error: null, params: null, duplicateOf: null });
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_theSameFileAgainChangesNothing', async () => {
        const { world, replacement } = replacementWorld();
        replacement.start(stored(), file('same.jpg'));
        replacement.snapshot(stored({ ...SERVER }, 'v2'));
        expect(replacement.state?.phase).toBe('uploading');

        world.uploads.at(0).end({ ok: true });
        await settle();

        expect(replacement.state?.phase).toBe('same');
    });

    it('badPath_aRefusedReplacementSaysWhyAndKeepsTheImage', async () => {
        const { world, replacement } = replacementWorld();
        replacement.start(stored(), file('new.heic'));
        world.uploads.at(0).end({ ok: true });
        await settle();

        replacement.snapshot(
            stored(
                { ...SERVER, replacement: { error: 'apiError.photo.duplicate', at: at('2026-10-17T11:00:00.000Z'), duplicateOf: 'p0' } },
                'v2',
            ),
        );

        expect(replacement.state).toMatchObject({ phase: 'refused', error: 'apiError.photo.duplicate', duplicateOf: 'p0' });
        replacement.dismiss();
        expect(replacement.state).toBeNull();
    });

    it('badPath_anOlderRefusalIsNotThisReplacements', async () => {
        const { world, replacement } = replacementWorld();
        const old = { error: 'apiError.photo.heicUnsupported' as const, at: at('2026-10-16T11:00:00.000Z') };
        replacement.start(stored({ replacement: old }), file('new.jpg'));
        world.uploads.at(0).end({ ok: true });
        await settle();

        replacement.snapshot(stored({ replacement: old, author: 'Ion', updatedBy: 'other-uid' }, 'v2'));
        expect(replacement.state?.phase).toBe('processing');
        replacement.snapshot(null);
        replacement.snapshot(stored({ ...SERVER, replacement: old }, 'v3'));

        expect(replacement.state?.phase).toBe('same');
    });

    it('badPath_cancelDuringTheUploadChangesNothing', async () => {
        const { world, replacement } = replacementWorld();
        replacement.start(stored(), file('new.jpg'));

        replacement.cancel();
        await settle();

        expect(world.uploads.at(0).cancelled).toBe(true);
        expect(replacement.state).toBeNull();
        replacement.snapshot(stored({ ...SERVER }, 'v2'));
        expect(replacement.state).toBeNull();
    });

    it('badPath_aSecondStartWhileUploadingIsIgnored', () => {
        const { world, replacement } = replacementWorld();
        replacement.start(stored(), file('a.jpg'));
        replacement.start(stored(), file('b.jpg'));
        replacement.dismiss();

        expect(world.uploads.started).toHaveLength(1);
        expect(replacement.state?.phase).toBe('uploading');
    });

    it.each([
        ['interrupted', 'adminContent.photos.upload.interrupted'],
        ['denied', 'apiError.notAdmin'],
    ] as const)('badPath_anUpload %s fails with its reason', async (reason, error) => {
        const { world, replacement } = replacementWorld();
        replacement.start(stored(), file('a.jpg'));
        world.uploads.at(0).progress(0, 0);

        world.uploads.at(0).end({ ok: false, reason });
        await settle();

        expect(replacement.state).toMatchObject({ phase: 'failed', error });
    });

    it('badPath_tooLargeOrNotAPhotosNameIsRefusedAtOnce', () => {
        const { world, replacement } = replacementWorld();

        replacement.start(stored(), file('big.jpg', 61 * 1024 * 1024));
        expect(replacement.state).toMatchObject({ phase: 'refused', error: 'adminContent.photos.tooBig', params: { size: '60' } });
        replacement.start(stored(), file('scan.pdf'));
        expect(replacement.state).toMatchObject({ phase: 'refused', error: 'apiError.photo.unsupportedType', params: null });
        expect(world.uploads.started).toEqual([]);
    });

    it('badPath_signedOutNothingIsSent', () => {
        const { world, replacement } = replacementWorld(null);

        replacement.start(stored(), file('a.jpg'));

        expect(replacement.state).toMatchObject({ phase: 'refused', error: 'apiError.unauthenticated' });
        expect(world.uploads.started).toEqual([]);
    });
});
