/**
 * The Imagery area (`#/imagery`, `docs/research/M3-interfaces.md` §1, §10.2; behaviours A11, A12, A14, A17, A42): the
 * USGS scenes ranked for the city with their footprints and browse images, Import in one click, the unfinished versions
 * with their jobs' progress (in progress, or waiting for the admin), a version's page with the approval card and the
 * compute-unit choices, and the GeoTIFF upload. The happy path is search (by itself when the harvest is stale), Import,
 * then nothing: the pipeline georeferences and the policy publishes under the city's threshold.
 */
import { isId, type PublishChoice } from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import type { ContentServices } from '../content/services.js';
import { Store } from '../state/store.js';
import { callImagery, refusalOf } from './api.js';
import { BrowseImages } from './browse.js';
import { ImageryFeeds, type FeedsPatch } from './feeds.js';
import { resumeGuard } from './guard.js';
import { JoinActions } from './join.js';
import { NO_FILES } from './files.js';
import { BROWSE_PICTURE, ImageryMap, sceneCorners } from './imagery-map.js';
import { sceneNamed, visibleScenes, wantsMore, type SceneFilters, type SceneItem } from './model.js';
import { OrderActions } from './orders/actions.js';
import { HarvestSearch } from './search.js';
import { INITIAL_IMAGERY, type ImageryDetail, type ImageryIntents, type ImageryState } from './state.js';
import { RasterUploader } from './upload.js';
import { VersionPage, type VersionPageState } from './version.js';
import { VersionImage } from './version-image.js';
import { VersionThumbs } from './version-thumbs.js';

/** The routed item's id when it is a `kind`, else null. */
function routedId(detail: ImageryDetail | null, kind: ImageryDetail['kind']): string | null {
    return detail?.kind === kind ? detail.id : null;
}

/** The routed item of `#/imagery/<kind>/<id>`, or null for the area alone (or an address that names none). */
export function detailOf(params: readonly string[]): ImageryDetail | null {
    const [kind, id] = params;
    return isDetailKind(kind) && isId(id) ? { kind, id } : null;
}

/** The layer of `#/imagery/replace/<layerId>` (the layer editor's Replace image), or null. */
export function replaceOf(params: readonly string[]): string | null {
    const [kind, id] = params;
    return kind === 'replace' && isId(id) ? id : null;
}

function isDetailKind(kind: string | undefined): kind is ImageryDetail['kind'] {
    return kind === 'scene' || kind === 'version' || kind === 'archive';
}

/** The same routed item (or none on both sides). */
function sameDetail(a: ImageryDetail | null, b: ImageryDetail | null): boolean {
    return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
}

/** The USGS scene the open version came from. */
function entityOf(version: VersionPageState | null): string | null {
    return version?.version.doc?.data.entityId ?? null;
}

class ImageryStore implements AreaStore<ImageryState, ImageryIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<ImageryState>;
    readonly #feeds: ImageryFeeds;
    readonly #search: HarvestSearch;
    readonly #browse: BrowseImages;
    readonly #uploader: RasterUploader;
    readonly #version: VersionPage;
    readonly #map: ImageryMap;
    readonly #orders: OrderActions;
    readonly #join: JoinActions;
    readonly #image: VersionImage;
    readonly #thumbs: VersionThumbs;
    #newest: string | null | undefined = undefined;
    /** Lesson 728: the scene count a filter's own next page was asked at (-1: none yet). */
    #moreAskedAt = -1;
    /** The scene whose browse image is on its way: every feed's write asks again, and each asking read and decoded it whole. */
    #browsing: string | null = null;
    readonly intents: ImageryIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<ImageryState>(INITIAL_IMAGERY, services.log);
        const files = services.files ?? NO_FILES;
        this.#feeds = new ImageryFeeds(services, (patch) => {
            this.#fed(patch);
        });
        this.#search = new HarvestSearch(services, (search) => {
            this.#cell.update({ search });
        });
        this.#browse = new BrowseImages(services, files, (browse) => {
            this.#cell.update({ browse });
        });
        this.#uploader = new RasterUploader(services, services.uploads, (upload) => {
            this.#cell.update({ upload });
        });
        this.#version = new VersionPage(services, files, (version) => {
            this.#versionChanged(version);
        });
        this.#map = new ImageryMap({
            ...{ maps: services.maps ?? null, locale: services.locale, files, pictures: services.pictures ?? null },
            status: (map) => {
                this.#cell.update({ map });
            },
            tilesFailed: () => {
                this.#image.tilesFailed();
            },
        });
        this.#image = new VersionImage({
            ...{ services, map: () => this.#map, opacity: () => this.#cell.state.previewOpacity },
            changed: (image) => {
                this.#cell.update({ image });
            },
        });
        this.#thumbs = new VersionThumbs({
            ...{ files, pictures: services.pictures ?? null },
            changed: (thumbs) => {
                this.#cell.update({ thumbs });
            },
        });
        this.#orders = new OrderActions(services, (orders) => {
            this.#cell.update(orders);
        });
        this.#join = new JoinActions(services, (join) => {
            this.#cell.update(join);
        });
        this.intents = this.#intents();
    }

    get state(): ImageryState {
        return this.#cell.state;
    }

    subscribe(listener: (state: ImageryState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#feeds.active) {
            this.#feeds.start(this.#cell.state.filters.freeOnly);
        }
        const replaceLayer = replaceOf(params);
        // M28: `#/imagery/upload` (the Sources step's "bring it into the app") opens the Upload tab.
        const upload = replaceLayer !== null || params[0] === 'upload';
        this.#cell.update(upload ? { replaceLayer, tab: 'upload' } : { replaceLayer });
        this.#select(detailOf(params));
    }

    close(): void {
        this.#feeds.stop();
        this.#select(null);
        this.#browse.clear();
        this.#thumbs.clear();
        this.#map.detach();
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    /** A GeoTIFF still being sent or checked: a reload would end it. */
    busy(): boolean {
        return this.#uploader.busy;
    }

    destroy(): void {
        this.close();
        this.#uploader.reset();
        this.#join.stop();
    }

    #intents(): ImageryIntents {
        const resumeGuard = (): Promise<boolean> => this.#resumeGuard();
        return {
            ...{ ...this.#findIntents(), ...this.#versionIntents(), ...this.#uploadIntents(), ...this.#orderIntents(), resumeGuard },
            joinFrames: (entityIds) => this.#join.join(entityIds),
            addTargetYear: (year) => this.#addYear(year),
            archive: async () => (await import('../archive/archive.js')).createArchiveFeed(this.#services),
            archiveElements: async () => {
                (await import('../archive/archive.js')).defineArchiveElements();
            },
        };
    }

    /** M8: Add {year} over the settings as read; the search then ranks with the year. */
    #addYear(year: number): Promise<boolean> {
        const target = { settings: this.#cell.state.settings, version: this.#feeds.cityVersion, search: () => this.#search.search() };
        return this.#join.addYear(year, target);
    }

    /** M4: the order card (`docs/research/M4-interfaces.md` §1.7). */
    #orderIntents(): Pick<ImageryIntents, 'markOrdered' | 'checkOrder' | 'cancelOrder' | 'markUnusable'> {
        const orders = this.#orders;
        return {
            markOrdered: (id) => orders.markOrdered(id),
            checkOrder: (id) => orders.checkOrder(id),
            cancelOrder: (id) => orders.cancelOrder(id),
            markUnusable: (id, reason) => orders.markUnusable(id, reason),
        };
    }

    /** Find: the tabs, the filters, the search, the scenes and their import. */
    #findIntents(): Pick<ImageryIntents, 'setTab' | 'setFilters' | 'search' | 'more' | 'retry' | 'importScene' | 'retryBrowse'> {
        return {
            setTab: (tab) => {
                this.#cell.update({ tab });
            },
            setFilters: (patch) => {
                this.#setFilters(patch);
            },
            search: () => this.#search.search(),
            more: () => {
                this.#feeds.moreScenes();
            },
            retry: () => {
                this.#retry();
            },
            importScene: (id, again) => this.#import(id, again === true),
            retryBrowse: (id) => {
                this.#retryBrowse(id);
            },
        };
    }

    /** The version's page: its decisions, its job, its preview on the map. */
    #versionIntents(): Pick<
        ImageryIntents,
        | 'approve'
        | 'recalibrate'
        | 'toggleCurrent'
        | 'reject'
        | 'confirmRights'
        | 'deleteVersion'
        | 'choose'
        | 'studioDone'
        | 'download'
        | 'retryJob'
        | 'locateAgain'
        | 'cancelJob'
        | 'setPreviewOpacity'
        | 'actualPixels'
        | 'retryImage'
        | 'attachMap'
        | 'zoomBy'
    > {
        const version = this.#version;
        return {
            ...{
                approve: (acceptWorse?: boolean) => version.approve(acceptWorse),
                recalibrate: () => version.recalibrate(),
                toggleCurrent: () => {
                    version.toggleCurrent();
                },
                reject: () => version.reject(),
                confirmRights: (confirmedBy: string) => version.confirmRights(confirmedBy),
                deleteVersion: () => version.deleteVersion(),
                choose: (choice: PublishChoice) => version.choose(choice),
            },
            ...{ studioDone: () => version.studioDone(), download: () => version.download(), retryJob: () => version.retry() },
            ...{ locateAgain: () => version.locateAgain(), cancelJob: () => version.cancel() },
            setPreviewOpacity: (percent) => {
                this.#setOpacity(percent);
            },
            actualPixels: () => {
                this.#actualPixels();
            },
            retryImage: () => {
                this.#image.retry();
            },
            attachMap: (container) => {
                this.#map.attach(container);
            },
            zoomBy: (delta) => {
                this.#map.zoomBy(delta);
            },
        };
    }

    /** The GeoTIFF upload. */
    #uploadIntents(): Pick<ImageryIntents, 'chooseFile' | 'setYear' | 'startUpload' | 'cancelUpload' | 'resetUpload'> {
        const uploader = this.#uploader;
        return {
            chooseFile: (file) => uploader.choose(file, this.#cell.state.replaceLayer),
            setYear: (text) => {
                uploader.setYear(text);
            },
            startUpload: () => {
                uploader.start();
            },
            cancelUpload: () => {
                uploader.cancel();
            },
            resetUpload: () => {
                uploader.reset();
            },
        };
    }

    #fed(patch: FeedsPatch): void {
        const { frame, newest, colors, ...rest } = patch;
        this.#mapFed(frame, colors);
        if (newest !== undefined) {
            this.#newest = newest;
        }
        this.#cell.update(rest);
        if (rest.scenes !== undefined || rest.orders !== undefined || rest.named !== undefined) {
            this.#scenesChanged();
        }
        this.#search.known(this.#cell.state.usgs, this.#newest);
        this.#thumbs.show(this.#cell.state.versions.items);
    }

    /** The city's frame (its boundary on the map) and its theme's colours, when the city was read. */
    #mapFed(frame: FeedsPatch['frame'], colors: FeedsPatch['colors']): void {
        if (frame !== undefined) {
            this.#map.setFrame(frame);
        }
        if (colors !== undefined) {
            this.#map.setColors(colors);
        }
        if (frame !== undefined || colors !== undefined) {
            this.#showFind();
        }
    }

    #setFilters(patch: Partial<SceneFilters>): void {
        const before = this.#cell.state.filters;
        const filters = { ...before, ...patch };
        this.#cell.update({ filters });
        if (filters.freeOnly !== before.freeOnly) {
            this.#feeds.showScenes(filters.freeOnly);
        }
        this.#scenesChanged();
    }

    /** The filters or the scenes changed: the list, its thumbnails and the map follow. */
    #scenesChanged(): void {
        const state = this.#cell.state;
        const visible = visibleScenes(state.scenes.items, state.filters);
        this.#cell.update({ visible });
        if (wantsMore(state.scenes, state.filters, visible.length, this.#moreAskedAt)) {
            this.#moreAskedAt = state.scenes.items.length;
            this.#feeds.moreScenes();
        }
        this.#browse.thumbnails(visible);
        this.#showFind();
    }

    #select(detail: ImageryDetail | null): void {
        if (sameDetail(detail, this.#cell.state.detail)) {
            return;
        }
        this.#cell.update({ detail, importRefusal: null });
        this.#map.clearPictures();
        this.#image.clear();
        this.#browsing = null;
        this.#feeds.showScene(routedId(detail, 'scene'));
        this.#version.show(routedId(detail, 'version'));
        this.#showFind();
    }

    /** The scene the route names, once the list, the orders (M4) or its own read has it. */
    #selectedScene(): SceneItem | null {
        const { detail, scenes, orders, named } = this.#cell.state;
        return detail?.kind === 'scene' ? sceneNamed(detail.id, [scenes.items, orders.items], named) : null;
    }

    /** Find's map: the footprints, the selected scene and its browse image. */
    #showFind(): void {
        if (this.#cell.state.detail?.kind === 'version') {
            return;
        }
        const scene = this.#selectedScene();
        this.#map.showScenes(scene);
        if (scene !== null) {
            this.#openBrowse(scene);
        }
    }

    /** The scene's browse image and its picture on the map, unless it is there or on its way. */
    #openBrowse(scene: SceneItem): void {
        if (this.#map.overlays.has(BROWSE_PICTURE) || this.#browsing === scene.id) {
            return;
        }
        this.#browsing = scene.id;
        void this.#browse.open(scene).then(() => this.#showBrowse(scene));
    }

    async #showBrowse(scene: SceneItem): Promise<void> {
        const path = this.#browse.pathOf(scene.id);
        if (path !== null && this.#selectedScene()?.id === scene.id) {
            await this.#map.showPicture(BROWSE_PICTURE, path, sceneCorners(scene), 1);
        }
        this.#browsing = null;
    }

    #retryBrowse(id: string): void {
        const { scenes, orders, named } = this.#cell.state;
        const scene = sceneNamed(id, [scenes.items, orders.items], named);
        if (scene !== null) {
            void this.#browse.retry(scene).then(() => this.#showBrowse(scene));
        }
    }

    async #import(id: string, again: boolean): Promise<string | null> {
        if (this.#cell.state.importing !== null) {
            return null;
        }
        this.#cell.update({ importing: id, importRefusal: null });
        try {
            const request = { cityId: this.#services.cityId, entityId: id, ...(again ? { again: true as const } : {}) };
            const answer = await callImagery(this.#services.callables, 'imagery.import', request);
            this.#cell.update({ importing: null });
            this.#services.notify({ key: 'adminContent.imagery.notice.imported' });
            return answer.versionId;
        } catch (error) {
            this.#cell.update({ importing: null, importRefusal: { id, notice: refusalOf(error) } });
            return null;
        }
    }

    #versionChanged(version: VersionPageState | null): void {
        this.#cell.update({ version });
        this.#readFrame(entityOf(version));
        this.#image.follow(version);
    }

    #actualPixels(): void {
        const output = this.#cell.state.version?.version.doc?.data.output ?? null;
        if (output !== null) {
            this.#map.actualPixels(output.maxzoom);
        }
    }

    /** M8: the frame's scene, read by its id, says how much of the city it covers (the page's offer to join). */
    #readFrame(entityId: string | null): void {
        if (entityId !== null) {
            this.#feeds.showScene(entityId);
        }
    }

    #setOpacity(percent: number): void {
        const previewOpacity = Math.min(100, Math.max(0, Math.round(percent))) / 100;
        this.#cell.update({ previewOpacity });
        this.#map.setVersionOpacity(previewOpacity);
    }

    #retry(): void {
        this.#feeds.retry();
        this.#version.retryListeners();
    }

    /** The budget guard's Resume processing (the page asks first). */
    async #resumeGuard(): Promise<boolean> {
        if (this.#cell.state.resuming) {
            return false;
        }
        this.#cell.update({ resuming: true });
        const resumed = await resumeGuard(this.#services);
        this.#cell.update({ resuming: false });
        return resumed;
    }
}

export const IMAGERY_MODULE: AreaModule<ImageryState, ImageryIntents> = {
    area: 'imagery',
    create: (services) => new ImageryStore(services),
};
