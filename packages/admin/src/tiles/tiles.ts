/**
 * The tile-import wizard's store (`#/help/<versionId>/tiles`, `docs/research/M20-import-local.md` §19.11; S-A-*-TILE-WIZARD-*): an
 * archive series waiting with `layout-check`. It follows the version; reads `layout.json` and the sprites of each new layout the
 * pipeline writes (a draft the owner is changing is kept until it is sent, so a newer layout refuses it as stale); keeps the owner's
 * draft; sends it for the real preview (`imagery.saveLayout` with `preview`) or on to points (`imagery.saveLayout`, or
 * `imagery.acceptLayout` when nothing changed).
 */
import { FIRESTORE_PATHS, isId, layerVersionDocSchema, type LayerVersionDoc, type Stitched, type StitchLayout } from '@hcm/shared';
import type { TilesIntentsPort, TilesViewState } from '@hcm/ui/admin';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, type DocState } from '../content/doc.js';
import type { ContentServices } from '../content/services.js';
import type { CallableFailure } from '../firebase/ports.js';
import { callImagery } from '../imagery/api.js';
import { NO_FILES, type FilePort } from '../imagery/files.js';
import { Store } from '../state/store.js';
import { ownerSheetsOf, sheetsOf, thumbSpriteOf, type DraftSheet } from './draft.js';
import { tilesIntentsOf, type TilesHost } from './intents.js';
import { loadLayout, releaseLayout, type LoadedLayout } from './load.js';
import { ownerSeamsOf, seamsAfter, seamSpriteOf, weakSeamsOf, type DraftSeam } from './seams.js';
import { INITIAL_TILES, seamPortOf, sheetPortOf } from './view.js';

/** The stitched picture of a series that waits for its tiles, with its layout. */
function waitingLayout(version: LayerVersionDoc): (Stitched & { readonly layout: StitchLayout }) | undefined {
    const stitched = waitingStitched(version);
    return stitched?.layout === undefined ? undefined : { ...stitched, layout: stitched.layout };
}

/** The stitched picture of a series parked with `layout-check`. */
function waitingStitched(version: LayerVersionDoc): Stitched | undefined {
    return version.state === 'needs_gcps' && version.help?.reason === 'layout-check' ? version.help.stitched : undefined;
}

/** A refused call as the page shows it (`callImagery` rejects with a `CallableFailure` only). */
function refusalOf(error: unknown): TilesViewState['refusal'] {
    const { code, params } = (error as CallableFailure).details;
    return params === undefined ? { key: code } : { key: code, params };
}

class TilesStore implements AreaStore<TilesViewState, TilesIntentsPort>, TilesHost {
    readonly #services: ContentServices;
    readonly #files: FilePort;
    readonly #cell: Store<TilesViewState>;
    readonly #doc: LiveDoc<LayerVersionDoc>;
    #sheets: readonly DraftSheet[] = [];
    #seams: readonly DraftSeam[] = [];
    #loaded: LoadedLayout | null = null;
    /** The layout's revision being read or shown (-1: none). */
    #revision = -1;
    /** The revision sent for the real preview (null: none waits). */
    #sent: number | null = null;
    #version: LayerVersionDoc | null = null;
    readonly intents: TilesIntentsPort;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#files = services.files ?? NO_FILES;
        this.#cell = new Store<TilesViewState>(INITIAL_TILES, services.log);
        const { store, clock, denied } = services;
        this.#doc = new LiveDoc({
            ...{ store, clock, denied, schema: layerVersionDocSchema },
            changed: (state) => {
                this.#docChanged(state);
            },
        });
        this.intents = tilesIntentsOf(this);
    }

    get state(): TilesViewState {
        return this.#cell.state;
    }

    get sheets(): readonly DraftSheet[] {
        return this.#sheets;
    }

    get seams(): readonly DraftSeam[] {
        return this.#seams;
    }

    subscribe(listener: (state: TilesViewState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        const id = params[0] ?? '';
        if (id === this.#cell.state.versionId) {
            return;
        }
        this.close();
        this.#cell.update({ versionId: id });
        if (isId(id)) {
            this.#doc.show(FIRESTORE_PATHS.layerVersion(this.#services.cityId, id));
        } else {
            this.#cell.update({ status: 'notFound' });
        }
    }

    close(): void {
        this.#doc.stop();
        releaseLayout(this.#files, this.#loaded);
        this.#loaded = null;
        this.#sheets = [];
        this.#seams = [];
        this.#revision = -1;
        this.#sent = null;
        this.#version = null;
        this.#cell.update(INITIAL_TILES);
    }

    hasUnsavedChanges(): boolean {
        return this.#cell.state.dirty;
    }

    destroy(): void {
        this.close();
    }

    update(patch: Partial<TilesViewState>): void {
        this.#cell.update(patch);
    }

    setSheets(sheets: readonly DraftSheet[], selected = this.#cell.state.selected): void {
        if (sheets !== this.#sheets) {
            this.#seams = seamsAfter(this.#seams, this.#sheets, sheets);
            this.#sheets = sheets;
            const seam = Math.min(this.#cell.state.seam, Math.max(this.#seams.length - 1, 0));
            this.#cell.update({ sheets: sheets.map(sheetPortOf), seams: this.#seamPorts(), seam, dirty: true, refusal: null });
        }
        this.#cell.update({ selected });
    }

    setSeams(seams: readonly DraftSeam[]): void {
        this.#seams = seams;
        this.#cell.update({ seams: this.#seamPorts(), dirty: true, refusal: null });
    }

    retry(): void {
        this.#revision = -1;
        if (this.#version === null) {
            this.#doc.retry();
            return;
        }
        this.#follow(this.#version);
    }

    async preview(): Promise<void> {
        const revision = this.#cell.state.revision;
        const sent = await this.#send(() => this.#save(true));
        if (sent) {
            this.#sent = revision;
            this.#cell.update({ previewing: true, dirty: false });
        }
    }

    async handOff(): Promise<void> {
        const dirty = this.#cell.state.dirty;
        const sent = await this.#send(() => (dirty ? this.#save(false) : this.#accept()));
        if (sent) {
            this.#cell.update({ handedOff: true, step: 'points', dirty: false });
        }
    }

    #seamPorts(): TilesViewState['seams'] {
        return this.#seams.map((seam) => seamPortOf(seam, this.#sheets));
    }

    #request(): { readonly cityId: string; readonly versionId: string; readonly revision: number } {
        return { cityId: this.#services.cityId, versionId: this.#cell.state.versionId, revision: this.#cell.state.revision };
    }

    async #save(preview: boolean): Promise<void> {
        const answer = { sheets: ownerSheetsOf(this.#sheets), seams: ownerSeamsOf(this.#seams), preview };
        await callImagery(this.#services.callables, 'imagery.saveLayout', { ...this.#request(), ...answer });
    }

    async #accept(): Promise<void> {
        await callImagery(this.#services.callables, 'imagery.acceptLayout', this.#request());
    }

    /** One call while busy; a refusal is shown, and a stale layout gives way to the newer one. */
    async #send(call: () => Promise<void>): Promise<boolean> {
        this.#cell.update({ busy: true, refusal: null });
        try {
            await call();
            this.#cell.update({ busy: false });
            return true;
        } catch (error) {
            const refusal = refusalOf(error);
            this.#cell.update({ busy: false, refusal });
            this.#stale(refusal);
            return false;
        }
    }

    #stale(refusal: TilesViewState['refusal']): void {
        if (refusal?.key === 'apiError.imagery.layoutStale' && this.#version !== null) {
            this.#cell.update({ dirty: false });
            this.#follow(this.#version);
        }
    }

    #docChanged(state: DocState<LayerVersionDoc>): void {
        if (state.status === 'error') {
            this.#cell.update({ status: 'error' });
            return;
        }
        if (state.status === 'loading') {
            return;
        }
        if (state.doc === null) {
            this.#cell.update({ status: 'notFound' });
            return;
        }
        this.#version = state.doc.data;
        this.#follow(state.doc.data);
    }

    #follow(version: LayerVersionDoc): void {
        const stitched = waitingLayout(version);
        if (stitched === undefined) {
            this.#gone();
            return;
        }
        const revision = stitched.layout.revision;
        if (revision === this.#revision || this.#cell.state.dirty) {
            return;
        }
        this.#revision = revision;
        void this.#load(version.layerId, stitched.previewPath, revision);
    }

    /**
     * No layout waits any more: handed off, or a preview under way, or another wait. While a call is in flight its own write
     * arrives first (the snapshot outruns the callable's answer): that is no move away.
     */
    #gone(): void {
        const { previewing, handedOff, busy } = this.#cell.state;
        if (!previewing && !handedOff && !busy) {
            this.#cell.update({ status: 'moved' });
        }
    }

    async #load(layerId: string, previewPath: string, revision: number): Promise<void> {
        const place = { cityId: this.#services.cityId, layerId, versionId: this.#cell.state.versionId };
        const loaded = await loadLayout(this.#files, place, previewPath);
        if (this.#revision !== revision) {
            releaseLayout(this.#files, loaded);
            return;
        }
        if (loaded === null) {
            this.#cell.update({ status: 'error' });
            return;
        }
        this.#show(loaded);
    }

    #show(loaded: LoadedLayout): void {
        releaseLayout(this.#files, this.#loaded);
        this.#loaded = loaded;
        const { file } = loaded;
        this.#sheets = sheetsOf(file);
        this.#seams = weakSeamsOf(file);
        const answered = this.#sent !== null && file.revision > this.#sent;
        this.#cell.update({
            ...{ status: 'ready', rows: file.rows, cols: file.cols, revision: file.revision, quality: file.quality },
            ...{ sheets: this.#sheets.map(sheetPortOf), seams: this.#seamPorts(), seam: 0, dirty: false },
            ...{ selected: { row: 0, col: 0 }, stitched: loaded.stitched },
            thumbs: loaded.thumbs === null ? null : { url: loaded.thumbs, ...thumbSpriteOf(file.sheets.length) },
            seamsSprite: loaded.seams === null ? null : { url: loaded.seams, ...seamSpriteOf(file.seams) },
            previewing: this.#cell.state.previewing && !answered,
        });
    }
}

/** The tile-import wizard's area (the route `help`). */
export const TILES_MODULE: AreaModule<TilesViewState, TilesIntentsPort> = {
    area: 'help',
    create: (services) => new TilesStore(services),
};
