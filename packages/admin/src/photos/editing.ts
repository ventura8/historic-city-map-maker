/**
 * The photos area's editing part (`docs/research/M2c-interfaces.md` §6.3, §6.4, §4.4, §4.6): the routed photo's
 * editor, its save (sticky fields and the last pin remembered, the place checked), the pin dragged on the map and the
 * direction set by a click on what the camera looked at or, from the keyboard, the map's centre.
 */
import { bearingBetween, roundTo, type LngLat } from '@hcm/shared';

import type { SuggestionField } from './autofill.js';
import type { AreaContext } from './context.js';
import type { PhotoPatch, PhotoValue } from './draft.js';
import { PhotoEditor } from './editor.js';
import { writeErrorKey } from './messages.js';
import type { PhotoVersionKind } from './replace.js';
import type { PhotoFile } from './upload-plan.js';

export interface EditingIntents {
    edit(patch: PhotoPatch): void;
    applySuggestion(field: SuggestionField): void;
    save(): Promise<boolean>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    /** Try again after the open photo's listener stopped. */
    retryPhoto(): void;
    /** Set direction: the next click on the map is what the camera looked at. */
    setDirection(): Promise<void>;
    cancelDirection(): void;
    /** The keyboard's way: the camera looked at the map's centre (the crosshair). */
    pointAtCentre(): void;
    placeAtCentre(): void;
    replaceImage(file: PhotoFile): void;
    cancelReplace(): void;
    dismissReplace(): void;
    /** A140: adds or replaces the improved or colorized version; Remove is an edit of `versions`, saved with the draft. */
    uploadVersion(kind: PhotoVersionKind, file: PhotoFile): void;
    cancelVersion(kind: PhotoVersionKind): void;
    dismissVersion(kind: PhotoVersionKind): void;
}

export class PhotoEditing {
    readonly #context: AreaContext;
    #editor: PhotoEditor | null = null;
    /** The pin moved on the map: the draft follows, and the drawing tools keep their own pin. */
    #pinFromMap = false;
    readonly intents: EditingIntents;

    constructor(context: AreaContext) {
        this.#context = context;
        this.intents = this.#makeIntents();
    }

    get editor(): PhotoEditor | null {
        return this.#editor;
    }

    /** Opens the routed photo's editor (null closes it). */
    open(photoId: string | null): void {
        const open = this.#editor;
        if (photoId === (open === null ? null : open.id)) {
            return;
        }
        open?.close();
        this.#editor = null;
        this.#pinFromMap = false;
        this.#context.photoChanged();
        if (photoId === null) {
            this.#context.set({ editor: null });
            this.#changed();
            return;
        }
        this.#create(photoId);
    }

    #create(photoId: string): void {
        const { services, memory, uploads } = this.#context;
        this.#editor = new PhotoEditor(photoId, {
            services,
            memory,
            bounds: () => this.#context.city()?.bounds ?? null,
            isNew: (id) => uploads.isNew(id),
            changed: (editor) => {
                this.#context.set({ editor });
                this.#changed();
            },
        });
        this.#context.set({ editor: this.#editor.state });
    }

    hasUnsavedChanges(): boolean {
        return this.#editor?.hasUnsavedChanges() ?? false;
    }

    refresh(): void {
        this.#editor?.refresh();
    }

    /** The map is ready: the pin of the open photo, if any. */
    mapReady(): void {
        this.#syncPin();
    }

    /** The pin was dragged: the draft's place follows. */
    pinMoved(position: LngLat): void {
        const editor = this.#editor;
        if (editor === null) {
            return;
        }
        this.#pinFromMap = true;
        this.#context.uploads.touched(editor.id);
        const location = { lat: position[1], lng: position[0] };
        editor.edit({ location });
        this.#context.placeSet(location);
    }

    /** The draft changed: the map shows it, and the pin follows a place typed in the fields. */
    #changed(): void {
        this.#context.showMap();
        if (!this.#pinFromMap) {
            this.#syncPin();
        }
        this.#pinFromMap = false;
    }

    #syncPin(): void {
        const map = this.#context.map();
        if (map === null) {
            return;
        }
        this.#showPin(map);
    }

    #showPin(map: NonNullable<ReturnType<AreaContext['map']>>): void {
        const open = this.#openPlace();
        void map.editPin(open?.location ?? null);
        // The open photo is brought into view once (PhotoMapSession.reveal).
        if (open?.location !== undefined) {
            map.reveal(open.id, open.location);
        }
    }

    /** The open photo's id and place (its draft's), or null with no photo open or loaded. */
    #openPlace(): { readonly id: string; readonly location: PhotoValue['location'] } | null {
        const editor = this.#editor;
        const value = editor === null ? null : editor.value;
        return editor === null || value === null ? null : { id: editor.id, location: value.location };
    }

    #edit(patch: PhotoPatch): void {
        const editor = this.#editor;
        if (editor !== null) {
            this.#context.uploads.touched(editor.id);
            editor.edit(patch);
        }
    }

    /** M13 §5: a photo with no place gets a pin at the map's centre, to drag. */
    #placeAtCentre(): void {
        const centre = this.#context.map()?.centre() ?? null;
        if (centre !== null) {
            this.pinMoved(centre);
            this.#syncPin();
        }
    }

    /** The bearing from the photo's place to `target`. */
    #pointAt(target: LngLat | null): void {
        const location = this.#editor?.value?.location;
        if (target !== null && location !== undefined) {
            this.#edit({ bearing: roundTo(bearingBetween([location.lng, location.lat], target), 1) });
        }
    }

    async #setDirection(): Promise<void> {
        const editor = this.#editor;
        const map = this.#context.map();
        if (editor === null || map === null) {
            return;
        }
        editor.setPicking(true);
        const target = await map.pick();
        editor.setPicking(false);
        this.#pointAt(target);
    }

    async #save(): Promise<boolean> {
        const editor = this.#editor;
        if (editor === null) {
            return false;
        }
        const value = editor.value;
        const moved = editor.state.dirty.includes('location');
        const outcome = await editor.save();
        if (!outcome.ok) {
            this.#context.services.notify({ key: writeErrorKey(outcome.reason) });
            return false;
        }
        this.#saved(editor.id, value, moved);
        return true;
    }

    #saved(photoId: string, value: PhotoValue | null, moved: boolean): void {
        const { memory, services, list } = this.#context;
        if (value !== null) {
            memory.rememberSticky(value);
            this.#context.set({ sticky: memory.sticky() });
        }
        if (value?.location !== undefined && moved) {
            memory.rememberPin([value.location.lng, value.location.lat]);
            memory.markCheckPlace(photoId, false);
            list.refresh();
        }
        services.notify({ key: 'adminContent.photos.saved' });
    }

    #applySuggestion(field: SuggestionField): void {
        const editor = this.#editor;
        if (editor !== null && !editor.applySuggestion(field)) {
            this.#context.services.notify({ key: 'adminContent.photos.suggestion.outside' });
        }
    }

    #makeIntents(): EditingIntents {
        return {
            edit: (patch) => {
                this.#edit(patch);
            },
            applySuggestion: (field) => {
                this.#applySuggestion(field);
            },
            save: () => this.#save(),
            discard: () => this.#editor?.discard(),
            keepMine: () => this.#editor?.keepMine(),
            takeTheirs: () => this.#editor?.takeTheirs(),
            retryPhoto: () => this.#editor?.retry(),
            setDirection: () => this.#setDirection(),
            cancelDirection: () => this.#context.map()?.cancelPick(),
            pointAtCentre: () => {
                this.#pointAt(this.#context.map()?.centre() ?? null);
            },
            placeAtCentre: () => {
                this.#placeAtCentre();
            },
            replaceImage: (file) => this.#editor?.replaceImage(file),
            cancelReplace: () => this.#editor?.cancelReplace(),
            dismissReplace: () => this.#editor?.dismissReplace(),
            uploadVersion: (kind, file) => this.#editor?.uploadVersion(kind, file),
            cancelVersion: (kind) => this.#editor?.cancelVersion(kind),
            dismissVersion: (kind) => this.#editor?.dismissVersion(kind),
        };
    }
}
