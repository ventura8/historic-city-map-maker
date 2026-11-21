// One open photo editor: its live photo, its states (loading, ready, not found, gone, error), publish on save for a
// new photo, the EXIF suggestions, the replacement and the unsaved guard.
import { describe, expect, it } from 'vitest';

import { PhotoEditor } from '../../src/photos/editor.js';
import { PhotoMemory } from '../../src/photos/session.js';
import type { PhotoEditorState } from '../../src/photos/state.js';
import { at, file, photoPath, photosWorld, seedPhoto, settle } from './world.js';

const BOUNDS = [
    [26, 44.3],
    [26.3, 44.55],
] as const;

function editorWorld(options: { isNew?: boolean; bounds?: typeof BOUNDS | null } = {}) {
    const world = photosWorld();
    const memory = new PhotoMemory(world.services.local);
    const states: PhotoEditorState[] = [];
    const open = (id = 'p1'): PhotoEditor =>
        new PhotoEditor(id, {
            services: world.services,
            memory,
            bounds: () => (options.bounds === undefined ? BOUNDS : options.bounds),
            isNew: () => options.isNew === true,
            changed: (state) => {
                states.push(state);
            },
        });
    return { world, memory, states, open };
}

describe('PhotoEditor', () => {
    it('happyPath_theOpenPhotoIsReadAndEdited', () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1', { suggested: { year: 1936 } });

        const editor = open();
        editor.edit({ author: 'Ion' });

        expect(editor.state).toMatchObject({
            id: 'p1',
            status: 'ready',
            dirty: ['author'],
            touched: true,
            processing: 'done',
            processingError: null,
            duplicateOf: null,
            block: null,
            checkPlace: false,
            suggestions: [{ field: 'year', text: '1936', outside: false }],
            picking: false,
            replace: null,
        });
        expect(editor.hasUnsavedChanges()).toBe(true);
        editor.discard();
        expect(editor.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_aNewPublishablePhotoStartsPublished', () => {
        const { world, open } = editorWorld({ isNew: true });
        seedPhoto(world, 'p1');

        const editor = open();

        expect(editor.state).toMatchObject({ dirty: ['published'], touched: false, value: { published: true } });
        expect(editor.hasUnsavedChanges()).toBe(false);
    });

    it('badPath_aNewPhotoAtTheFallbackPinDoesNotStartPublished', () => {
        const { world, memory, open } = editorWorld({ isNew: true });
        seedPhoto(world, 'p1');
        memory.markCheckPlace('p1', true);

        const editor = open();

        expect(editor.state).toMatchObject({ dirty: [], block: 'place', checkPlace: true });
    });

    it('badPath_aPhotoThatDoesNotExistIsNotFound', () => {
        const { open } = editorWorld({ bounds: null });

        expect(open('ghost').state).toMatchObject({
            status: 'notFound',
            value: null,
            image: null,
            processing: 'pending',
            block: null,
            suggestions: [],
        });
    });

    it('badPath_aPhotoDeletedWhileOpenIsGone', () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1');
        const editor = open();

        world.store.drop(photoPath('p1'));

        expect(editor.state.status).toBe('gone');
    });

    it('badPath_aRefusedReadIsAnErrorWithTryAgain', () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1', { processing: 'failed', image: undefined, processingError: 'apiError.photo.duplicate', duplicateOf: 'p0' });
        const editor = open();
        expect(editor.state).toMatchObject({ processingError: 'apiError.photo.duplicate', duplicateOf: 'p0', block: 'failed' });

        world.store.fail(photoPath('p1'), { kind: 'denied', code: 'permission-denied' });
        expect(editor.state).toMatchObject({ status: 'error', failure: { kind: 'denied' } });

        editor.retry();
        expect(editor.state.status).toBe('ready');
    });
});

describe('PhotoEditor: suggestions, replacement and saving', () => {
    it('happyPath_aSuggestionIsAppliedToTheDraft', () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1', { suggested: { year: 1936, location: { lat: 47, lng: 27 } } });
        const editor = open();

        expect(editor.applySuggestion('year')).toBe(true);
        expect(editor.applySuggestion('location')).toBe(false);

        expect(editor.state).toMatchObject({ dirty: ['year'], value: { year: 1936 } });
    });

    it('badPath_noSuggestionWithoutThePhoto', () => {
        const { open } = editorWorld();

        expect(open('ghost').applySuggestion('year')).toBe(false);
    });

    it('happyPath_theReplacementAndPickingShowInTheState', async () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1');
        const editor = open();

        editor.setPicking(true);
        editor.replaceImage(file('new.jpg'));

        expect(editor.state).toMatchObject({ picking: true, replace: { phase: 'uploading' } });
        expect(editor.hasUnsavedChanges()).toBe(true);
        world.uploads.at(0).end({ ok: true });
        await settle();
        world.store.put(photoPath('p1'), {
            ...world.store.docs.get(photoPath('p1')),
            updatedBy: 'system:photos',
            updatedAt: at('2026-10-17T12:30:00.000Z'),
        });
        expect(editor.state.replace?.phase).toBe('same');
        editor.dismissReplace();
        expect(editor.state.replace).toBeNull();
    });

    it('badPath_closingWhileReplacingCancelsTheUpload', () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1');
        const editor = open();
        editor.replaceImage(file('new.jpg'));

        editor.close();

        expect(world.uploads.at(0).cancelled).toBe(true);
        expect(world.store.listeners(photoPath('p1'))).toBe(0);
        editor.cancelReplace();
    });

    it('badPath_noReplacementWithoutThePhoto', () => {
        const { world, open } = editorWorld();
        const editor = open('ghost');

        editor.replaceImage(file('new.jpg'));
        editor.close();

        expect(world.uploads.started).toEqual([]);
    });

    it('happyPath_saveAndConflictChoicesReachTheDraft', async () => {
        const { world, open } = editorWorld();
        seedPhoto(world, 'p1');
        const editor = open();
        editor.edit({ author: 'Ion' });
        world.store.put(photoPath('p1'), {
            ...world.store.docs.get(photoPath('p1')),
            author: 'Ana',
            updatedBy: 'other',
            updatedAt: at('2026-10-17T11:00:00.000Z'),
        });
        expect(editor.state.conflict).not.toBeNull();

        editor.keepMine();
        await expect(editor.save()).resolves.toEqual({ ok: true });
        editor.takeTheirs();

        expect(world.store.docs.get(photoPath('p1'))).toMatchObject({ author: 'Ion' });
    });
});
