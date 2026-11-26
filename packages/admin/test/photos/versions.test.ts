// A photo's improved and colorized versions in the admin (the owner 2026-11-09; A140): the upload names its version in its
// metadata, the server's write ends it, a wrong file is refused at once, and Remove is an edit saved with the draft.
import type { PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { Stored } from '../../src/content/services.js';
import { PhotoEditor } from '../../src/photos/editor.js';
import { PhotoReplacement } from '../../src/photos/replace.js';
import { PhotoMemory } from '../../src/photos/session.js';
import { at, file, photoDoc, photoPath, photosWorld, seedPhoto, settle } from './world.js';

const SHA = 'c'.repeat(64);
const VERSION = {
    image: { web: 'https://x/v.webp', thumb: 'https://x/vt.webp', w: 1, h: 1, sha256: SHA },
    original: { path: 'originals/photos/bucharest/p1/c.jpg', contentType: 'image/jpeg', bytes: 1, sha256: SHA },
} as const;

function stored(overrides: Partial<PhotoDoc> = {}, version = 'v1'): Stored<PhotoDoc> {
    return { id: 'p1', path: photoPath('p1'), data: photoDoc(overrides), version, pending: false };
}

describe('PhotoReplacement of a version', () => {
    it('happyPath_theUploadNamesItsVersionAndTheServersWriteEndsIt', async () => {
        const world = photosWorld();
        const replacement = new PhotoReplacement({ services: world.services, version: 'colorized', changed: () => undefined });

        replacement.start(stored(), file('color.jpg'));
        expect(world.uploads.at(0).request).toMatchObject({ customMetadata: { originalName: 'color.jpg', version: 'colorized' } });
        world.uploads.at(0).end({ ok: true });
        await settle();
        replacement.snapshot(stored({ updatedBy: 'system:photos', versions: { colorized: VERSION } }, 'v2'));

        expect(replacement.state?.phase).toBe('replaced');
    });

    it('badPath_aFileThatIsNoPhotoIsRefusedAtOnce', () => {
        const world = photosWorld();
        const replacement = new PhotoReplacement({ services: world.services, version: 'improved', changed: () => undefined });

        replacement.start(stored(), file('notes.txt'));

        expect(replacement.state).toMatchObject({ phase: 'refused', error: 'apiError.photo.unsupportedType' });
        expect(world.uploads.started).toEqual([]);
    });
});

function editorWorld() {
    const world = photosWorld();
    seedPhoto(world, 'p1');
    const editor = new PhotoEditor('p1', {
        services: world.services,
        memory: new PhotoMemory(world.services.local),
        bounds: () => null,
        isNew: () => false,
        changed: () => undefined,
    });
    return { world, editor };
}

describe('PhotoEditor versions', () => {
    it('happyPath_eachVersionHasItsOwnUpload', async () => {
        const { world, editor } = editorWorld();

        editor.uploadVersion('improved', file('better.jpg'));
        expect(editor.state.versionUploads).toMatchObject({ improved: { phase: 'uploading' }, colorized: null });
        expect(editor.hasUnsavedChanges()).toBe(true);
        world.uploads.at(0).end({ ok: true });
        await settle();
        world.store.put(photoPath('p1'), {
            ...world.store.docs.get(photoPath('p1')),
            versions: { improved: VERSION },
            updatedBy: 'system:photos',
            updatedAt: at('2026-11-09T12:30:00.000Z'),
        });

        expect(editor.state.versionUploads.improved?.phase).toBe('replaced');
        expect(editor.state.value?.versions?.improved?.image.sha256).toBe(SHA);
        editor.dismissVersion('improved');
        expect(editor.state.versionUploads.improved).toBeNull();
    });

    it('badPath_closingCancelsAVersionStillUploadingAndNothingWithoutThePhoto', () => {
        const { world, editor } = editorWorld();
        editor.uploadVersion('colorized', file('color.jpg'));

        editor.close();
        editor.cancelVersion('colorized');

        expect(world.uploads.at(0).cancelled).toBe(true);
        const ghost = new PhotoEditor('ghost', {
            services: world.services,
            memory: new PhotoMemory(world.services.local),
            bounds: () => null,
            isNew: () => false,
            changed: () => undefined,
        });
        ghost.uploadVersion('improved', file('x.jpg'));
        expect(world.uploads.started).toHaveLength(1);
    });
});
