/**
 * What a version's page shows on the map (`docs/research/M12-own-tiles.md`, S-A74-*): the owner sees exactly what they approve. A version
 * with tiles asks `imagery.previewUrl` for an hour of its private archive and draws it at full zoom on the page's one map, through the
 * same source the public viewer uses. A version with none yet (one rendered before M12, until the sweep makes them), or one whose tiles
 * cannot be read, shows its small picture instead, and the page says why (`image-view.ts`: on its way, never coming, or gone), with Try
 * again where it helps. The address is a credential for its hour: it stays in this object and in the map, never in the area's state, a log
 * or a document. An hour on, a failing tile is the address running out, not the image: a new one is asked for on its own (S-A74-BAD-HOUR-
 * OVER), and only a tile that fails within its hour says so.
 */
import { IMAGERY_PREVIEW_URL_SECONDS } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf } from './api.js';
import { PREVIEW_PICTURE, type ImageryMap } from './imagery-map.js';
import { cornersOfBox } from './overlay.js';
import type { VersionPageState } from './version.js';
import type { VersionView } from './version-view.js';

type Output = NonNullable<VersionView['output']>;

/** `small`: only the small picture exists; `loading`: its address is on its way; `ready`: the tiles are on the map; `failed`: why not. */
export type VersionImageState =
    { readonly status: 'none' | 'small' | 'loading' | 'ready' } | { readonly status: 'failed'; readonly notice: NoticeInput };

export const NO_IMAGE: VersionImageState = { status: 'none' };

/** A tile failed on the map within its address's hour: the network went, or the bucket refused. */
const TILES_FAILED: NoticeInput = { key: 'adminContent.imagery.view.tilesFailed' };

export interface VersionImageDeps {
    readonly services: Pick<ContentServices, 'callables' | 'cityId' | 'clock'>;
    readonly map: () => ImageryMap;
    readonly opacity: () => number;
    readonly changed: (image: VersionImageState) => void;
}

/** The version the map shows: the open one, or (M16) the current one a recalibration would replace, when the owner asked for it. */
function shownOf(page: VersionPageState): VersionView | null {
    return page.showing === 'current' && page.current !== null ? page.current : (page.version.doc?.data ?? null);
}

/** A rejected version's tiles are gone (`S-A72-HAPPY-REJECTED`), so only its small picture is left to ask for. */
function tilesOf(version: VersionView): Output['tiles'] {
    return version.state === 'rejected' ? null : (version.output?.tiles ?? null);
}

/** M16: a published version is drawn from its public archive (its private one went when it was published). */
function publicOf(version: VersionView): string | null {
    return version.state === 'published' ? version.publicUrl : null;
}

/** Published while open, its private archive goes: a new public address redraws it, before a tile is read from the gone one. */
function shownKey(id: string, file: string, publicUrl: string | null): string {
    return `${id}@${file}@${publicUrl ?? ''}`;
}

export class VersionImage {
    readonly #deps: VersionImageDeps;
    /** What is on the map (`<version>@<file>@<public address>`), '' for nothing. */
    #shown = '';
    /** Bumped by every asking: a slower answer about an older version is dropped. */
    #asked = 0;
    #open: { readonly id: string; readonly output: Output; readonly publicUrl: string | null } | null = null;
    /**
     * When the address on the map runs out, by this page's clock (the hour counted from its answer: a clock set wrong on this computer moves
     * nothing); infinite while an address is on its way, when a failing tile is the old address's.
     */
    #until = Number.POSITIVE_INFINITY;

    constructor(deps: VersionImageDeps) {
        this.#deps = deps;
    }

    /** The open version changed: draws it the first time its output is known, and again if its file changes. */
    follow(page: VersionPageState | null): void {
        const version = page === null ? null : shownOf(page);
        if (version?.output) {
            this.#draw(version, version.output);
        }
    }

    #draw(version: VersionView, output: Output): void {
        const { id } = version;
        const tiles = tilesOf(version);
        const publicUrl = publicOf(version);
        const shown = shownKey(id, tiles?.path ?? output.previewPath, publicUrl);
        if (shown === this.#shown) {
            return;
        }
        this.#shown = shown;
        this.#open = { id, output, publicUrl };
        this.#deps.map().fitBox(output.bounds);
        if (tiles === null) {
            this.#until = Number.POSITIVE_INFINITY;
            this.#small();
            this.#deps.changed({ status: 'small' });
        } else {
            void this.#ask();
        }
    }

    /** The selection changed: nothing is drawn, and an answer still on its way is dropped. */
    clear(): void {
        this.#asked += 1;
        this.#shown = '';
        this.#open = null;
        this.#until = Number.POSITIVE_INFINITY;
        this.#deps.map().clearVersion();
        this.#deps.changed(NO_IMAGE);
    }

    /** Try again after a refusal or a failed tile. */
    retry(): void {
        void this.#ask();
    }

    /**
     * A tile of the archive failed. Past the address's hour a new address is asked for, once per hour; within it the small picture stands
     * in, and nothing keeps asking for tiles.
     */
    tilesFailed(): void {
        if (this.#open === null || this.#until === Number.POSITIVE_INFINITY) {
            return;
        }
        if (this.#deps.services.clock.now() >= this.#until) {
            void this.#ask();
            return;
        }
        this.#fall(TILES_FAILED);
    }

    async #ask(): Promise<void> {
        const open = this.#open;
        if (open === null) {
            return;
        }
        this.#asked += 1;
        const asked = this.#asked;
        this.#until = Number.POSITIVE_INFINITY;
        this.#deps.changed({ status: 'loading' });
        try {
            const address = await this.#addressOf(open);
            if (asked === this.#asked) {
                this.#until = address.until;
                this.#deps.map().showVersion(open.output, address.url, this.#deps.opacity());
                this.#deps.changed({ status: 'ready' });
            }
        } catch (error) {
            if (asked === this.#asked) {
                this.#fall(refusalOf(error));
            }
        }
    }

    /** Where the archive is read, and until when: an hour of the private one, or (M16) a published version's public one, for good. */
    async #addressOf(open: { readonly id: string; readonly publicUrl: string | null }): Promise<{ url: string; until: number }> {
        if (open.publicUrl !== null) {
            return { url: open.publicUrl, until: Number.MAX_VALUE };
        }
        const { callables, cityId, clock } = this.#deps.services;
        const answer = await callImagery(callables, 'imagery.previewUrl', { cityId, versionId: open.id });
        return { url: answer.url, until: clock.now() + IMAGERY_PREVIEW_URL_SECONDS * 1000 };
    }

    #fall(notice: NoticeInput): void {
        this.#until = Number.POSITIVE_INFINITY;
        this.#small();
        this.#deps.changed({ status: 'failed', notice });
    }

    #small(): void {
        const open = this.#open;
        if (open !== null) {
            const map = this.#deps.map();
            map.showVersion(open.output, null, this.#deps.opacity());
            void map.showPicture(PREVIEW_PICTURE, open.output.previewPath, cornersOfBox(open.output.bounds), this.#deps.opacity());
        }
    }
}
