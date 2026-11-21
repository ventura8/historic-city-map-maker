/**
 * The places area's photos: the picker's list (the city's photos, newest first, read when it first opens, a page at a time)
 * and the open place's linked photos, each read by its id (the place's editor names them by title, from the first look and
 * whatever pages the picker read). A linked photo that cannot be read, or is gone, has no title: the editor shows its id.
 */
import { FIRESTORE_PATHS, photoDocSchema, type PhotoDoc } from '@hcm/shared';

import { LiveDoc, type LiveDocDeps } from '../content/doc.js';
import { LiveList, type ListState } from '../content/list.js';
import { photoChoiceOf, type PhotoChoice } from './places.js';

type PhotosParts = Pick<LiveDocDeps<PhotoDoc>, 'store' | 'clock' | 'denied'> & {
    readonly cityId: string;
    /** M13 §1: an uploader's uid: the rules read the query, so theirs must ask for their own photos and no others. */
    readonly ownerOnly: () => string | null;
};

/** What changed: the picker's list, or the linked photos. */
export interface PhotosPatch {
    readonly photos?: ListState<PhotoChoice>;
    readonly linkedPhotos?: readonly PhotoChoice[];
}

export class PlacePhotos {
    readonly #parts: PhotosParts;
    readonly #changed: (patch: PhotosPatch) => void;
    readonly #list: LiveList<PhotoDoc, PhotoChoice>;
    readonly #reads = new Map<string, LiveDoc<PhotoDoc>>();
    readonly #linked = new Map<string, PhotoChoice>();
    /** The picker asked for its list (Try again has nothing to try before). */
    #listed = false;

    constructor(parts: PhotosParts, changed: (patch: PhotosPatch) => void) {
        this.#parts = parts;
        this.#changed = changed;
        const { cityId, store, clock, denied } = parts;
        this.#list = new LiveList({
            ...{ store, clock, denied },
            collection: FIRESTORE_PATHS.photos(cityId),
            schema: photoDocSchema,
            map: photoChoiceOf,
            changed: (photos) => {
                changed({ photos });
            },
        });
    }

    /** The picker opened: its list, read once. */
    load(): void {
        this.#listed = true;
        if (!this.#list.active) {
            const owner = this.#parts.ownerOnly();
            this.#list.show({ ...(owner === null ? {} : { where: [['createdBy', '==', owner]] }), orderBy: [['updatedAt', 'desc']] });
        }
    }

    more(): void {
        this.#list.more();
    }

    retry(): void {
        if (this.#listed) {
            this.#list.retry();
        }
    }

    /** Reads the photos of `ids` not read yet (one chosen in the picker meanwhile too). */
    showLinked(ids: readonly string[]): void {
        for (const id of ids.filter((candidate) => !this.#reads.has(candidate))) {
            this.#read(id);
        }
    }

    /** The open place changed: its linked photos' reads go. */
    stopLinked(): void {
        for (const read of this.#reads.values()) {
            read.stop();
        }
        this.#reads.clear();
        this.#linked.clear();
    }

    stop(): void {
        this.#list.stop();
        this.stopLinked();
    }

    #read(id: string): void {
        const { cityId, store, clock, denied } = this.#parts;
        const read = new LiveDoc<PhotoDoc>({
            ...{ store, clock, denied },
            schema: photoDocSchema,
            changed: (state) => {
                if (state.doc !== null) {
                    this.#linked.set(id, photoChoiceOf(state.doc));
                    this.#changed({ linkedPhotos: [...this.#linked.values()] });
                }
            },
        });
        this.#reads.set(id, read);
        read.show(FIRESTORE_PATHS.photo(cityId, id));
    }
}
