/**
 * The places area's state and intents (docs/research/M2c-interfaces.md §2.1, §7): what `hcm-pois-page` renders and calls
 * (mirrored structurally by `@hcm/ui/admin`'s `pois-port.ts`), and the services the area is created with.
 */
import { NO_ASSIST, type AssistState } from '../assist/assist.js';
import type { AssistIntents } from '../assist/editor-assists.js';
import type { ListState } from '../content/list.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { LOADING_LIST } from '../content/list.js';
import type { AdminMapFactory } from '../map/factory.js';
import type { BulkAction } from './bulk.js';
import type { PlaceEditorState } from './editor.js';
import type { ImportFile, ImportState } from './importer.js';
import type { MapStatus } from './map-session.js';
import type { CategoryItem, CityFrame, PoiItem, PoiPatch } from './model.js';
import type { PhotoChoice, PoisFilter } from './places.js';
import type { TraceLayerItem } from './trace-layers.js';
import type { PlaceShape, VertexEdit } from './vertices.js';

export interface PoisState {
    readonly filter: PoisFilter;
    readonly list: ListState<PoiItem>;
    readonly categories: ListState<CategoryItem>;
    /** The city's bounds and view, once read. */
    readonly frame: CityFrame | null;
    /** The bulk selection, in the order chosen. */
    readonly selection: readonly string[];
    readonly editor: PlaceEditorState | null;
    readonly map: MapStatus;
    /** A place clicked on the map: the page opens it (`seq` changes with every click). */
    readonly clicked: { readonly id: string; readonly seq: number } | null;
    /** The photo picker's list, read when it first opens. */
    readonly photos: ListState<PhotoChoice> | null;
    /** The open place's linked photos, each read by its id: past the picker's pages, or with the picker not opened yet. */
    readonly linkedPhotos: readonly PhotoChoice[];
    /** Export all is reading the city's places. */
    readonly exporting: boolean;
    readonly importing: ImportState | null;
    /** A delete or a bulk action is being written. */
    readonly busy: boolean;
    /** M4 (CR-M4-4): the open place's title suggestions and translation drafts. */
    readonly assist: AssistState;
    /** M27: the city's old maps a street can be traced on, by year. */
    readonly traceLayers: readonly TraceLayerItem[];
    /** M27: the traced-on map's opacity under the drawing, in percent. */
    readonly traceOpacity: number;
}

/** A file for the browser to save (the export). */
export interface SavedFile {
    readonly name: string;
    readonly type: string;
    readonly text: string;
}

export interface PoisIntents extends AssistIntents {
    setFilter(filter: Partial<PoisFilter>): void;
    more(): void;
    retry(): void;
    /** A new place of `shape` in the last used category; its id, for the page to open. */
    add(shape: PlaceShape): string;
    edit(patch: PoiPatch): void;
    setTool(tool: 'select' | 'draw'): void;
    /** Starts the open place's shape again (the page asked first). */
    redraw(shape: PlaceShape): void;
    selectVertex(index: number | null): void;
    editVertex(edit: VertexEdit): boolean;
    /** Adds a vertex at the map's centre (the crosshair) after the selected one. */
    addAtCentre(): boolean;
    undoLastVertex(): boolean;
    save(): Promise<WriteOutcome | null>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    /** Adds the starter categories to a city that has none (finding 35 of 2026-11-01): the open place takes the first. */
    addStarterCategories(): Promise<WriteOutcome>;
    /** Deletes the open place (the page asked first); the snackbar offers Undo. */
    remove(): Promise<WriteOutcome | null>;
    toggleSelected(id: string): void;
    selectAll(): void;
    clearSelection(): void;
    bulk(action: BulkAction): Promise<void>;
    loadPhotos(): void;
    /** The picker's next page of photos. */
    morePhotos(): void;
    chooseImport(file: ImportFile): Promise<void>;
    setImportCategory(category: string): void;
    commitImport(): Promise<void>;
    closeImport(): void;
    /** Every place of the city, or the selection, as a GeoJSON file; null (the snackbar says so) when they could not be read. */
    exportPlaces(onlySelection: boolean): Promise<SavedFile | null>;
    attachMap(container: HTMLElement): void;
    detachMap(): void;
    zoomBy(delta: number): void;
    /** M27: fades the old map under the drawing (0..100 %) to compare with today's streets. */
    setTraceOpacity(percent: number): void;
}

export type ListIntent =
    'setFilter' | 'more' | 'retry' | 'add' | 'toggleSelected' | 'selectAll' | 'clearSelection' | 'bulk' | 'loadPhotos' | 'morePhotos';
export type FileIntent =
    | 'chooseImport'
    | 'setImportCategory'
    | 'commitImport'
    | 'closeImport'
    | 'exportPlaces'
    | 'attachMap'
    | 'detachMap'
    | 'zoomBy'
    | 'setTraceOpacity';

/** The services the places area is created with: the editors' own and the pois' map factory. */
export type PoisServices = ContentServices & { readonly maps?: AdminMapFactory | null };

export const INITIAL_POIS_STATE: PoisState = {
    ...{ filter: { category: null, unpublished: false, search: '' }, list: LOADING_LIST, categories: LOADING_LIST, frame: null },
    ...{ selection: [], editor: null, map: 'none', clicked: null, photos: null, importing: null, busy: false, assist: NO_ASSIST },
    ...{ linkedPhotos: [], exporting: false, traceLayers: [], traceOpacity: 100 },
};
