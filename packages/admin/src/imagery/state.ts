/**
 * The Imagery area's state and intents (`docs/research/M3-interfaces.md` §10.2, §10.3): USGS's state and the city's
 * imagery settings, the search, the ranked scenes with their filters and browse images, the unfinished versions with
 * their jobs, the open scene or version, the upload, and the page's map.
 */
import {
    imagerySettingsOf,
    type BBox,
    type DatePlanRow,
    type ImagerySettings,
    type PublishChoice,
    type ServiceState,
    type UnusableReason,
} from '@hcm/shared';
import { sourcesOf, type SourceChoices } from '@hcm/shared/sources';

import type { ArchiveFeed } from '../archive/feed.js';
import { LOADING_LIST, type ListState } from '../content/list.js';
import type { MapStatus } from '../layers/map-session.js';
import type { NoticeInput } from '../state/state.js';
import type { BrowseImage } from './browse.js';
import type { GuardView } from './guard.js';
import { IDLE_JOIN, type JoinActionsState } from './join.js';
import {
    DEFAULT_FILTERS,
    NO_NAMED_SCENE,
    type JobProgress,
    type NamedScene,
    type SceneFilters,
    type SceneItem,
    type VersionItem,
} from './model.js';
import { IDLE_ORDERS, type OrderActionsState } from './orders/actions.js';
import { IDLE_SEARCH, type SearchState } from './search.js';
import { IDLE_UPLOAD, type ChosenFile, type UploadState } from './upload.js';
import type { VersionPageState } from './version.js';
import { NO_IMAGE, type VersionImageState } from './version-image.js';

/** The list pane's three views: Find (the scenes), Work (in progress and waiting for you), Upload. */
type ImageryTab = 'find' | 'work' | 'upload';

/** The routed item: `#/imagery/scene/<entityId>` or `#/imagery/version/<versionId>`. */
export interface ImageryDetail {
    readonly kind: 'scene' | 'version' | 'archive';
    readonly id: string;
}

/**
 * M4 (`docs/research/M4-interfaces.md` §1.7): the order card's action and refusal (`OrderActionsState`). M8
 * (`docs/research/M8-join-interfaces.md` §6): the join's (`JoinActionsState`).
 */
export interface ImageryState extends OrderActionsState, JoinActionsState {
    readonly tab: ImageryTab;
    /** `setup/status.usgs.state` (null while reading): `missing` or `invalid` is the "set up USGS" state. */
    readonly usgs: ServiceState | null;
    readonly settings: ImagerySettings;
    /** The city's bounds (null until the city was read): a version whose footprint lies mostly outside them asks before Approve. */
    readonly city: BBox | null;
    /** M28: the city's sources (defaults until it chose): the USGS search and the local import follow them. */
    readonly sources: SourceChoices;
    readonly search: SearchState;
    readonly filters: SceneFilters;
    /** The scenes as read (free only when the filter says so, best score first). */
    readonly scenes: ListState<SceneItem>;
    /** The scenes the filters keep, in the list's order. */
    readonly visible: readonly SceneItem[];
    /** M4: the scenes that have an order, whatever the filters. */
    readonly orders: ListState<SceneItem>;
    /** The routed scene read by its id: a scene the filters hide or past the list's page opens too. */
    readonly named: NamedScene;
    readonly browse: Readonly<Record<string, BrowseImage>>;
    readonly versions: ListState<VersionItem>;
    /** The unfinished jobs by id (a version's job has the version's id). */
    readonly jobs: Readonly<Record<string, JobProgress>>;
    readonly detail: ImageryDetail | null;
    /** The version's page, while one is open. */
    readonly version: VersionPageState | null;
    /** The scene an Import runs for. */
    readonly importing: string | null;
    readonly importRefusal: { readonly id: string; readonly notice: NoticeInput } | null;
    readonly upload: UploadState;
    readonly map: MapStatus;
    /** The version's opacity on the map, 0 to 1: 1 at first, as its layer starts once published (`functions/src/imagery/finalize.ts`). */
    readonly previewOpacity: number;
    /** `#/imagery/replace/<layerId>` (the layer editor's Replace image): the upload replaces that layer's image. */
    readonly replaceLayer: string | null;
    /** The budget guard (null while reading): paused, with the spend the alert reported (CR-M3-47). */
    readonly guard: GuardView | null;
    /** Resume processing is on its way. */
    readonly resuming: boolean;
    /** M8: the server's plan of each date's whole-city layer, best first. */
    readonly dates: readonly DatePlanRow[];
    /** M12: how far the open version's picture has come. */
    readonly image: VersionImageState;
    /** M12: Work's small pictures by version id, as `blob:` addresses. */
    readonly thumbs: Readonly<Record<string, string>>;
}

export const INITIAL_IMAGERY: ImageryState = {
    ...{ tab: 'find', usgs: null, settings: imagerySettingsOf(undefined), city: null, sources: sourcesOf(undefined) },
    ...{ search: IDLE_SEARCH, filters: DEFAULT_FILTERS },
    ...{ scenes: LOADING_LIST, visible: [], browse: {}, versions: LOADING_LIST, jobs: {}, detail: null, version: null },
    ...{ importing: null, importRefusal: null, upload: IDLE_UPLOAD, map: 'none', previewOpacity: 1 },
    ...{ replaceLayer: null, guard: null, resuming: false, orders: LOADING_LIST, named: NO_NAMED_SCENE, ...IDLE_ORDERS },
    ...{ dates: [], ...IDLE_JOIN, image: NO_IMAGE, thumbs: {} },
};

export interface ImageryIntents {
    setTab(tab: ImageryTab): void;
    setFilters(patch: Partial<SceneFilters>): void;
    /** Search USGS again (`imagery.search`). */
    search(): Promise<void>;
    /** The next page of scenes. */
    more(): void;
    /** Try again after a listener's failure. */
    retry(): void;
    /** `imagery.import` of a free scene: the new version's id (the page opens it), or null when refused. `again`: an imported one, once more. */
    importScene(id: string, again?: boolean): Promise<string | null>;
    retryBrowse(id: string): void;
    /** M16: `acceptWorse`: the owner chose a recalibration not shown better. */
    approve(acceptWorse?: boolean): Promise<boolean>;
    /** M16: Refine automatically (the new version's id, or null), and the map between the new version and the current one. */
    recalibrate(): Promise<string | null>;
    toggleCurrent(): void;
    reject(): Promise<boolean>;
    /** M20 (§7): the city's owner confirms who granted the permission (`imagery.confirmRights`). */
    confirmRights(confirmedBy: string): Promise<boolean>;
    /** A version that never reached the map, deleted for good (`imagery.deleteVersion`); true once it is gone. */
    deleteVersion(): Promise<boolean>;
    choose(choice: PublishChoice): Promise<boolean>;
    studioDone(): Promise<boolean>;
    /** Saves the Studio file. */
    download(): Promise<boolean>;
    /** `imagery.retry` of the open version's failed job. */
    retryJob(): Promise<boolean>;
    /** `imagery.locateAgain` of the open version, a frame waiting for points. */
    locateAgain(): Promise<boolean>;
    /** Turns the budget guard green again (`imagery.resumeGuard`); true once it is. */
    resumeGuard(): Promise<boolean>;
    cancelJob(): Promise<boolean>;
    chooseFile(file: ChosenFile): Promise<void>;
    setYear(text: string): void;
    startUpload(): void;
    cancelUpload(): void;
    /** Choose another file. */
    resetUpload(): void;
    /** The preview's opacity slider, in percent. */
    setPreviewOpacity(percent: number): void;
    /** M12: the open version at one tile pixel on one screen pixel. */
    actualPixels(): void;
    /** M12: asks for the open version's tiles again. */
    retryImage(): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    /** M4: "I ordered it" (`usgs.markOrdered`); true once recorded. */
    markOrdered(id: string): Promise<boolean>;
    /** M4: "Check now" (`usgs.checkOrder`). */
    checkOrder(id: string): Promise<boolean>;
    /** M4: "Take the mark back" (`usgs.cancelOrder`). */
    cancelOrder(id: string): Promise<boolean>;
    /** The owner's report of 2026-11-13: Not useful with why, or Undo with null (`imagery.markScene`); true once recorded. */
    markUnusable(id: string, reason: UnusableReason | null): Promise<boolean>;
    /** M8: `imagery.join` of one date's frames: the join version's id (the page opens it), or null when refused. */
    joinFrames(entityIds: readonly string[]): Promise<string | null>;
    /** M8: Add {year} to target years, then search again; true once it is saved. */
    addTargetYear(year: number): Promise<boolean>;
    /** M20 (`docs/research/M20-import-local.md` §8): Import local files' feed, from the lazy `archive` chunk. */
    archive(): Promise<ArchiveFeed>;
    /** M20: registers the `archive` chunk's elements (the Upload view's card, an archive's report). */
    archiveElements(): Promise<void>;
}
