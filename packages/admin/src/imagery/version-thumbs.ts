/**
 * The small pictures of Work's waiting rows (`docs/research/M12-own-tiles.md`, S-A75-*): each row that waits for the owner shows the
 * `thumb.webp` the pipeline made, through `PicturePort`, one at a time and with no map. A row with none (a version from before M12, a
 * file the bucket refuses) keeps its text and its icon. Every address is released when the area closes.
 */
import type { FilePort, PicturePort } from './files.js';
import type { VersionItem } from './model.js';

/** A row's 64 px at twice the density. */
const THUMB_SIDE = 128;
/** The list makes at most this many: a page of work, never every version of a city. */
const MAX_THUMBS = 24;

export interface VersionThumbsDeps {
    readonly files: FilePort;
    readonly pictures: PicturePort | null;
    readonly changed: (thumbs: Readonly<Record<string, string>>) => void;
}

export class VersionThumbs {
    readonly #deps: VersionThumbsDeps;
    readonly #urls = new Map<string, string>();
    /** The versions asked for, by what they asked: a picture is made once. */
    readonly #asked = new Set<string>();
    /** Bumped by `clear`: a picture that arrives for an older opening is released at once. */
    #generation = 0;

    constructor(deps: VersionThumbsDeps) {
        this.#deps = deps;
    }

    /** The waiting rows of the list as read. */
    show(versions: readonly VersionItem[]): void {
        const waiting = versions.filter((version) => version.needsYou && version.thumbPath !== null).slice(0, MAX_THUMBS);
        for (const version of waiting.filter((row) => !this.#asked.has(row.id))) {
            this.#asked.add(version.id);
            void this.#make(version.id, String(version.thumbPath));
        }
    }

    async #make(id: string, path: string): Promise<void> {
        const generation = this.#generation;
        const read = (): Promise<Blob | null> => (generation === this.#generation ? this.#deps.files.read(path) : Promise.resolve(null));
        const url = (await this.#deps.pictures?.thumbnail(read, THUMB_SIDE)) ?? null;
        if (url === null) {
            return;
        }
        if (generation === this.#generation) {
            this.#urls.set(id, url);
            this.#emit();
        } else {
            this.#deps.files.release(url);
        }
    }

    /** The area closed: every address is released. */
    clear(): void {
        this.#generation += 1;
        for (const url of this.#urls.values()) {
            this.#deps.files.release(url);
        }
        this.#urls.clear();
        this.#asked.clear();
        this.#emit();
    }

    #emit(): void {
        this.#deps.changed(Object.fromEntries(this.#urls));
    }
}
