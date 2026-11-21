/**
 * One open photo editor (`docs/research/M2c-interfaces.md` §6.3, §6.4; behaviours A09, A37, A38): the photo's live
 * document, its draft, its replacement upload, the EXIF suggestions not applied yet, and the direction pick. The
 * store creates one per routed photo and closes it when the route leaves it.
 */
import { FIRESTORE_PATHS, photoDocSchema, type BBox, type PhotoDoc } from '@hcm/shared';

import { LiveDoc, type DocState } from '../content/doc.js';
import type { Stored, WriteOutcome } from '../content/services.js';
import { pendingSuggestions, suggestionPatch, type SuggestionField } from './autofill.js';
import { PhotoDraft, type PhotoDraftState, type PhotoPatch, type PhotoValue } from './draft.js';
import { publishBlock } from './model.js';
import type { PhotosServices } from './ports.js';
import { PhotoReplacement, type PhotoVersionKind } from './replace.js';
import type { PhotoMemory } from './session.js';
import type { PhotoEditorState } from './state.js';
import type { PhotoFile } from './upload-plan.js';

export interface PhotoEditorDeps {
    readonly services: Pick<
        PhotosServices,
        'cityId' | 'store' | 'uploads' | 'user' | 'clock' | 'denied' | 'people' | 'readOnly' | 'cityRole'
    >;
    readonly memory: PhotoMemory;
    readonly bounds: () => BBox | null;
    /** Created in this session: Published starts on (publish on save, §5.4). */
    readonly isNew: (photoId: string) => boolean;
    readonly changed: (state: PhotoEditorState) => void;
}

function statusOf(draft: PhotoDraftState, doc: DocState<PhotoDoc>): PhotoEditorState['status'] {
    if (doc.status === 'error') {
        return 'error';
    }
    if (!draft.loaded) {
        return 'loading';
    }
    if (draft.gone) {
        return 'gone';
    }
    return draft.base === null ? 'notFound' : 'ready';
}

/** What the editor shows of the stored photo beside the draft (server-owned fields). */
function factsOf(photo: PhotoDoc | null): Pick<PhotoEditorState, 'image' | 'processing' | 'processingError' | 'duplicateOf'> {
    if (photo === null) {
        return { image: null, processing: 'pending', processingError: null, duplicateOf: null };
    }
    return {
        image: photo.image ?? null,
        processing: photo.processing,
        processingError: photo.processingError ?? null,
        duplicateOf: photo.duplicateOf ?? null,
    };
}

/** Why Published cannot be switched on, for the draft's licence. */
function blockOf(photo: PhotoDoc | null, value: PhotoValue | null, checkPlace: boolean): PhotoEditorState['block'] {
    return photo === null ? null : publishBlock({ ...photo, license: value === null ? photo.license : value.license }, checkPlace);
}

function suggestionsOf(photo: PhotoDoc | null, bounds: BBox | null): PhotoEditorState['suggestions'] {
    return photo === null || bounds === null ? [] : pendingSuggestions(photo, bounds);
}

export class PhotoEditor {
    readonly id: string;
    readonly #deps: PhotoEditorDeps;
    readonly #draft: PhotoDraft;
    readonly #replace: PhotoReplacement;
    readonly #versions: Readonly<Record<PhotoVersionKind, PhotoReplacement>>;
    readonly #doc: LiveDoc<PhotoDoc>;
    #picking = false;
    #state: PhotoEditorState;

    constructor(id: string, deps: PhotoEditorDeps) {
        this.id = id;
        this.#deps = deps;
        const { services } = deps;
        this.#draft = new PhotoDraft(id, {
            store: services.store,
            cityId: services.cityId,
            bounds: deps.bounds,
            clock: services.clock,
            preset: (photo) => this.#preset(photo),
            locked: () => services.readOnly(),
            changed: (draft) => {
                // A conflict names who saved: the shell learns the admins' names once (DECISIONS-for-review.md §42c).
                if (draft.conflict !== null) {
                    services.people();
                }
                this.#emit();
            },
        });
        this.#replace = new PhotoReplacement({
            services,
            changed: () => {
                this.#emit();
            },
        });
        const version = (kind: PhotoVersionKind): PhotoReplacement =>
            new PhotoReplacement({
                services,
                version: kind,
                changed: () => {
                    this.#emit();
                },
            });
        this.#versions = { improved: version('improved'), colorized: version('colorized') };
        this.#doc = new LiveDoc({
            store: services.store,
            clock: services.clock,
            schema: photoDocSchema,
            changed: (doc) => {
                this.#read(doc);
            },
            denied: services.denied,
        });
        this.#state = this.#derive();
        this.#doc.show(FIRESTORE_PATHS.photo(services.cityId, id));
    }

    get state(): PhotoEditorState {
        return this.#state;
    }

    /** The stored photo, once read. */
    get stored(): Stored<PhotoDoc> | null {
        return this.#draft.state.base;
    }

    get value(): PhotoValue | null {
        return this.#draft.state.value;
    }

    /** Published starts on for a new, publishable photo (§5.4). */
    #preset(photo: Stored<PhotoDoc>): PhotoPatch {
        const ready = publishBlock(photo.data, this.#deps.memory.checkPlace().has(photo.id)) === null;
        return this.#deps.isNew(photo.id) && !photo.data.published && ready ? { published: true } : {};
    }

    /** A new state of the photo's listener: a snapshot rebases the draft; a failure only shows. */
    #read(doc: DocState<PhotoDoc>): void {
        if (doc.status === 'ready') {
            this.#draft.rebase(doc.doc);
            for (const replacement of this.#all()) {
                replacement.snapshot(doc.doc);
            }
        } else {
            this.#emit();
        }
    }

    /** Try again after the photo's listener stopped. */
    retry(): void {
        this.#doc.retry();
    }

    edit(patch: PhotoPatch): void {
        this.#draft.edit(patch);
    }

    /** Applies one EXIF suggestion to the draft (a position outside the city is refused: nothing changes). */
    applySuggestion(field: SuggestionField): boolean {
        const stored = this.stored;
        const bounds = this.#deps.bounds();
        const patch = stored === null || bounds === null ? {} : suggestionPatch(stored.data, field, bounds);
        if (Object.keys(patch).length > 0) {
            this.#draft.edit(patch);
        }
        return Object.keys(patch).length > 0;
    }

    save(): Promise<WriteOutcome> {
        return this.#draft.save();
    }

    discard(): void {
        this.#draft.discard();
    }

    keepMine(): void {
        this.#draft.keepMine();
    }

    takeTheirs(): void {
        this.#draft.takeTheirs();
    }

    setPicking(picking: boolean): void {
        this.#picking = picking;
        this.#emit();
    }

    replaceImage(file: PhotoFile): void {
        const stored = this.stored;
        if (stored !== null) {
            this.#replace.start(stored, file);
        }
    }

    cancelReplace(): void {
        this.#replace.cancel();
    }

    dismissReplace(): void {
        this.#replace.dismiss();
    }

    /** The owner 2026-11-09 (A140): adds or replaces the improved or colorized version with `file`. */
    uploadVersion(kind: PhotoVersionKind, file: PhotoFile): void {
        const stored = this.stored;
        if (stored !== null) {
            this.#versions[kind].start(stored, file);
        }
    }

    cancelVersion(kind: PhotoVersionKind): void {
        this.#versions[kind].cancel();
    }

    dismissVersion(kind: PhotoVersionKind): void {
        this.#versions[kind].dismiss();
    }

    #all(): readonly PhotoReplacement[] {
        return [this.#replace, this.#versions.improved, this.#versions.colorized];
    }

    #uploading(): readonly PhotoReplacement[] {
        return this.#all().filter((replacement) => replacement.state?.phase === 'uploading');
    }

    /** An edit the admin made and has not saved, or a replacement still uploading. */
    hasUnsavedChanges(): boolean {
        const draft = this.#draft.state;
        return (draft.touched && draft.dirty.length > 0) || this.#uploading().length > 0;
    }

    /** The route left the photo: stop listening; a replacement still uploading is cancelled (the guard asked first). */
    close(): void {
        this.#doc.stop();
        for (const replacement of this.#uploading()) {
            replacement.cancel();
        }
    }

    #derive(): PhotoEditorState {
        const draft = this.#draft.state;
        const photo = draft.base === null ? null : draft.base.data;
        const checkPlace = this.#deps.memory.checkPlace().has(this.id);
        return {
            role: this.#deps.services.cityRole(),
            ...{
                id: this.id,
                status: statusOf(draft, this.#doc.state),
                reconnecting: this.#doc.state.reconnecting,
                failure: this.#doc.state.failure,
            },
            ...{ value: draft.value, dirty: draft.dirty, touched: draft.touched },
            ...{ issues: draft.issues, saving: draft.saving, conflict: draft.conflict, ...factsOf(photo), checkPlace },
            block: blockOf(photo, draft.value, checkPlace),
            suggestions: suggestionsOf(photo, this.#deps.bounds()),
            picking: this.#picking,
            replace: this.#replace.state,
            versionUploads: { improved: this.#versions.improved.state, colorized: this.#versions.colorized.state },
        };
    }

    /** The state again (the place was checked elsewhere, the city's bounds arrived). */
    refresh(): void {
        this.#emit();
    }

    #emit(): void {
        this.#state = this.#derive();
        this.#deps.changed(this.#state);
    }
}
