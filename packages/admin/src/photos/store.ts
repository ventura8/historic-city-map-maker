/**
 * The photos area (`docs/research/M2c-interfaces.md` §2.1, §6): one store per signed-in admin, created when the photos
 * page first opens. It holds the list (filters, search, selection), the batch uploads, the open editor
 * (`editing.ts`), the actions on whole photos (`actions.ts`) and the page's map, and renders through one immutable
 * `PhotosState`. `open(params)` attaches the listeners for the routed photo (`#/photos/<photoId>`), `close()` detaches
 * them and the map; uploads go on until sign-out (`destroy`).
 */
import { bboxCenter, bboxFromRecord, cityDocSchema, FIRESTORE_PATHS, type CityDoc, type LngLat } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { EditorAssists } from '../assist/editor-assists.js';
import { LiveDoc } from '../content/doc.js';
import { ownerOnlyOf, type Stored } from '../content/services.js';
import { PhotoActions, type ActionIntents } from './actions.js';
import { photoAssists, type PhotoAssistIntents } from './assists.js';
import type { AreaContext, CityPlace } from './context.js';
import { PhotoEditing, type EditingIntents } from './editing.js';
import { PhotoList } from './list.js';
import { PhotoMapSession, type MapPhoto } from './map.js';
import { nullable, type PhotoFilter, type PhotoSearch } from './model.js';
import type { PhotosServices } from './ports.js';
import { PhotoMemory } from './session.js';
import { initialPhotosState, type PhotosState } from './state.js';
import type { PhotoFile } from './upload-plan.js';
import { UploadQueue } from './upload-queue.js';

/** The zoom the map opens at when the city names none. */
export const DEFAULT_CITY_ZOOM = 13;

export interface ListIntents {
    setFilter(filter: PhotoFilter): void;
    search(search: PhotoSearch): void;
    more(): void;
    retry(): void;
    toggleSelected(photoId: string): void;
    selectAll(): void;
    clearSelection(): void;
}

export interface UploadIntents {
    upload(files: readonly PhotoFile[]): void;
    retryUpload(key: number): void;
    cancelUpload(key: number): void;
    dismissUpload(key: number): void;
    clearUploads(): void;
}

export interface MapIntents {
    /** Creates the page's map in `container`; a click on a photo calls `open` with its id. */
    attachMap(container: HTMLElement, open: (photoId: string) => void): void;
    detachMap(): void;
    /** Moves the map to a photo (selected in the list). */
    focusPhoto(photoId: string): void;
    /** The map box's zoom buttons: one step in (+1) or out (-1). */
    zoomBy(delta: number): void;
}

export type PhotosIntents = ListIntents & UploadIntents & EditingIntents & ActionIntents & MapIntents & PhotoAssistIntents;

/** The area store of the contract (`AreaStore<PhotosState, PhotosIntents>`, §2.1). */
export interface PhotosStore {
    readonly state: PhotosState;
    subscribe(listener: (state: PhotosState) => void): Unsubscribe;
    readonly intents: PhotosIntents;
    /** The page shows; `params[0]` is the routed photo. */
    open(params: readonly string[]): void;
    close(): void;
    /** Whether leaving now would lose an edit. */
    hasUnsavedChanges(): boolean;
    /** Photos of the upload queue still being sent: a reload would end them. */
    busy(): boolean;
    destroy(): void;
}

/** The city's bounds and the map's first view. */
export function cityPlace(city: Pick<CityDoc, 'bounds' | 'center' | 'zoom'>): CityPlace {
    const bounds = bboxFromRecord(city.bounds);
    const center: LngLat = city.center === undefined ? bboxCenter(bounds) : [city.center.lng, city.center.lat];
    return { bounds, view: { center, zoom: city.zoom ?? DEFAULT_CITY_ZOOM, bearing: 0 } };
}

/** What the list reads through. */
function listPartsOf(services: PhotosServices) {
    const { store, clock, cityId, denied } = services;
    return { store, clock, cityId, denied, ownerOnly: () => ownerOnlyOf(services) };
}

export class PhotosArea implements PhotosStore {
    readonly #services: PhotosServices;
    readonly #listeners = new Set<(state: PhotosState) => void>();
    readonly #context: AreaContext;
    readonly #editing: PhotoEditing;
    readonly #assists: EditorAssists;
    readonly intents: PhotosIntents;
    #state: PhotosState;
    #city: CityPlace | null = null;
    readonly #cityDoc: LiveDoc<CityDoc>;
    #map: PhotoMapSession | null = null;
    #container: HTMLElement | null = null;

    constructor(services: PhotosServices) {
        this.#services = services;
        const memory = new PhotoMemory(services.local);
        this.#state = initialPhotosState(memory.sticky(), services.cityRole());
        const list = new PhotoList({
            ...listPartsOf(services),
            checkPlace: () => memory.checkPlace(),
            changed: (state) => {
                this.#set({ list: state });
                this.#showMap();
            },
        });
        this.#cityDoc = new LiveDoc({
            store: services.store,
            clock: services.clock,
            schema: cityDocSchema,
            changed: (city) => {
                this.#cityRead(city.doc);
            },
            denied: services.denied,
        });
        const uploads = new UploadQueue({
            services,
            memory,
            bounds: () => this.#city?.bounds ?? null,
            changed: (items) => {
                this.#set({ uploads: items });
                list.refresh();
            },
        });
        this.#context = {
            ...{ services, memory, list, uploads },
            state: () => this.#state,
            set: (patch) => {
                this.#set(patch);
            },
            city: () => this.#city,
            map: () => this.#map,
            showMap: () => {
                this.#showMap();
            },
            placeSet: (location) => {
                this.#assists.placeSet(location);
            },
            photoChanged: () => {
                this.#assists.reset();
            },
        };
        this.#editing = new PhotoEditing(this.#context);
        this.#assists = this.#newAssists();
        const actions = new PhotoActions(this.#context, this.#editing);
        this.intents = {
            ...this.#listIntents(),
            ...this.#uploadIntents(),
            ...this.#editing.intents,
            ...actions.intents,
            ...this.#mapIntents(),
            ...this.#assists.intents,
        };
    }

    get state(): PhotosState {
        return this.#state;
    }

    /** M4 (CR-M4-4): the editor's assists over the open photo's draft. */
    #newAssists(): EditorAssists {
        return photoAssists({
            services: this.#services,
            value: () => this.#editing.editor?.value ?? null,
            fileTitle: () => this.#editing.editor?.stored?.data.suggested?.title,
            edit: (patch) => {
                this.#editing.intents.edit(patch);
            },
            changed: (assist) => {
                this.#set({ assist });
            },
        });
    }

    subscribe(listener: (state: PhotosState) => void): Unsubscribe {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    open(params: readonly string[]): void {
        this.#context.list.open();
        if (this.#cityDoc.path === '') {
            this.#cityDoc.show(FIRESTORE_PATHS.city(this.#services.cityId));
        }
        this.#editing.open(params[0] ?? null);
    }

    close(): void {
        this.#context.list.close();
        this.#cityDoc.stop();
        this.#editing.open(null);
        this.#detachMap();
    }

    hasUnsavedChanges(): boolean {
        return this.#editing.hasUnsavedChanges();
    }

    busy(): boolean {
        return this.#context.uploads.busy();
    }

    destroy(): void {
        this.close();
        this.#context.uploads.destroy();
        this.#listeners.clear();
    }

    #set(patch: Partial<PhotosState>): void {
        this.#state = { ...this.#state, ...patch };
        for (const listener of this.#listeners) {
            listener(this.#state);
        }
    }

    /** The city's bounds and view, once read (a city without a document keeps the last ones). */
    #cityRead(city: Stored<CityDoc> | null): void {
        if (city !== null) {
            this.#city = cityPlace(city.data);
            this.#editing.refresh();
            this.#context.uploads.cityKnown();
            void this.#attachWhenReady();
        }
    }

    /** Every loaded photo, the edited one from its draft (titles in the admin's language). */
    #mapPhotos(): readonly MapPhoto[] {
        const english = this.#services.locale() === 'en';
        const editor = this.#editing.editor;
        const draft = editor?.value ?? null;
        const photos = this.#context.list.docs
            .filter((stored) => stored.id !== editor?.id)
            .map((stored) => ({ id: stored.id, photo: stored.data }));
        const shown = editor === null || draft === null ? photos : [...photos, { id: editor.id, photo: draft }];
        return shown.flatMap(({ id, photo }) =>
            photo.location === undefined
                ? []
                : [
                      {
                          id,
                          title: english ? (photo.title.en ?? photo.title.ro) : photo.title.ro,
                          year: nullable(photo.year),
                          location: photo.location,
                          bearing: nullable(photo.bearing),
                          fov: nullable(photo.fov),
                      },
                  ],
        );
    }

    #showMap(): void {
        this.#map?.show(this.#mapPhotos());
    }

    #attachMap(container: HTMLElement, open: (photoId: string) => void): void {
        this.#detachMap();
        this.#container = container;
        this.#map = new PhotoMapSession(this.#services.maps ?? null, {
            status: (map) => {
                this.#set({ map });
                if (map === 'ready') {
                    this.#showMap();
                    this.#editing.mapReady();
                }
            },
            select: open,
            pin: (position) => {
                this.#editing.pinMoved(position);
            },
            refused: () => {
                this.#services.notify({ key: 'adminContent.photos.pin.outside' });
            },
        });
        void this.#attachWhenReady();
    }

    /** Creates the map once its container and the city are both known. */
    async #attachWhenReady(): Promise<void> {
        const { map, container, city } = { map: this.#map, container: this.#container, city: this.#city };
        if (map === null || container === null || city === null || this.#state.map !== 'none') {
            return;
        }
        await map.attach(container, { bounds: city.bounds, view: city.view, locale: this.#services.locale() });
    }

    #detachMap(): void {
        this.#map?.detach();
        this.#map = null;
        this.#container = null;
    }

    #listIntents(): ListIntents {
        const list = this.#context.list;
        return {
            setFilter: (filter) => {
                list.setFilter(filter);
            },
            search: (search) => {
                list.setSearch(search);
            },
            more: () => {
                list.more();
            },
            retry: () => {
                list.retry();
            },
            toggleSelected: (photoId) => {
                list.toggle(photoId);
            },
            selectAll: () => {
                list.selectAll();
            },
            clearSelection: () => {
                list.select([]);
            },
        };
    }

    #uploadIntents(): UploadIntents {
        const uploads = this.#context.uploads;
        return {
            upload: (files) => {
                uploads.add(files);
            },
            retryUpload: (key) => {
                uploads.retry(key);
            },
            cancelUpload: (key) => {
                uploads.cancel(key);
            },
            dismissUpload: (key) => {
                uploads.dismiss(key);
            },
            clearUploads: () => {
                uploads.clearFinished();
            },
        };
    }

    #mapIntents(): MapIntents {
        return {
            attachMap: (container, open) => {
                this.#attachMap(container, open);
            },
            detachMap: () => {
                this.#detachMap();
            },
            focusPhoto: (photoId) => {
                const stored = this.#context.list.doc(photoId);
                if (stored?.data.location !== undefined) {
                    this.#map?.focus(stored.data.location);
                }
            },
            zoomBy: (delta) => {
                this.#map?.zoomBy(delta);
            },
        };
    }
}
