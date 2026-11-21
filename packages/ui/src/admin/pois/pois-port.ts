/**
 * What the places page needs from the admin's places area (docs/research/M2c-interfaces.md §2.3, §7): `@hcm/ui` sits
 * below `@hcm/admin` (dependency-cruiser `ui-below-apps`), so these types mirror `packages/admin/src/pois/state.ts` and
 * its parts structurally; `packages/admin/test/app/admin-port.test.ts` checks at compile time that the real store
 * satisfies `PoisAreaPort`. The elements render the state and call the intents; they never touch Firestore or the
 * map's library themselves (the map's host element is handed to the store).
 */
import type { LngLat, ValidationIssue } from '@hcm/shared';

import type { AreaPort, ListStatePort, StoredPort } from '../area-port.js';
import type { AssistActionsPort, AssistViewPort } from '../assist/assist-port.js';

export type PoiShapePort = 'point' | 'linestring' | 'polygon';

export type MapStatusPort = 'none' | 'loading' | 'ready' | 'no-token' | 'no-webgl' | 'failed';

export type DrawRefusalKindPort = 'outside' | 'self-intersection' | 'too-many-vertices' | 'too-many-rings' | 'zero-area';

export interface PoiTextPort {
    readonly ro: string;
    readonly en?: string;
}

type PoiGeometryPort =
    | { readonly type: 'Point'; readonly coordinates: LngLat }
    | { readonly type: 'LineString'; readonly coordinates: readonly LngLat[] }
    | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };

export interface PoiLinkPort {
    readonly url: string;
    readonly label: string;
}

export interface PoiValuePort {
    readonly category: string;
    readonly geometry: PoiGeometryPort | null;
    readonly title: PoiTextPort;
    readonly description?: PoiTextPort;
    readonly yearStart?: number;
    readonly yearEnd?: number;
    /** M27: plan year when start/end are unknown. */
    readonly yearSeen?: number;
    readonly links: readonly PoiLinkPort[];
    readonly photoIds: readonly string[];
    readonly published: boolean;
    /** M27: the id of the layer the street was traced on. */
    readonly sourceLayer?: string;
}

/** A change the editor sends; `undefined` clears an optional field. */
export type PoiPatchPort = { readonly [K in keyof PoiValuePort]?: PoiValuePort[K] | undefined };

export interface PoiItemPort {
    readonly id: string;
    readonly category: string;
    readonly title: PoiTextPort;
    readonly yearStart: number | null;
    readonly yearEnd: number | null;
    readonly yearSeen?: number | null;
    readonly shape: 'point' | 'line' | 'area';
    readonly published: boolean;
}

export interface CategoryItemPort {
    readonly id: string;
    readonly label: PoiTextPort;
    readonly icon: string;
    readonly color: string;
}

/** M27: an old map a street can be traced on. */
export interface TraceLayerPort {
    readonly id: string;
    readonly label: PoiTextPort;
    readonly year: number;
}

export interface PoiDraftPort {
    readonly id: string;
    readonly isNew: boolean;
    readonly base: StoredPort<unknown> | null;
    readonly value: PoiValuePort;
    readonly dirty: readonly string[];
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: { readonly by: string; readonly at: string; readonly fields: readonly string[] } | null;
    readonly gone: boolean;
}

export interface PlaceEditorPort {
    readonly id: string;
    readonly status: 'loading' | 'ready' | 'not-found' | 'error';
    readonly reconnecting: boolean;
    readonly draft: PoiDraftPort | null;
    readonly shape: PoiShapePort;
    readonly sketch: readonly LngLat[];
    readonly vertex: number | null;
    readonly refusal: DrawRefusalKindPort | null;
}

export type ImportRefusalReasonPort =
    | 'unsupported-type'
    | 'altitude'
    | 'open-ring'
    | 'too-many-positions'
    | 'outside'
    | 'bad-shape'
    | 'unknown-category'
    | 'invalid'
    | 'unreadable-place';

interface ImportPlanPort {
    readonly created: readonly unknown[];
    readonly updated: readonly unknown[];
    readonly unchanged: number;
    readonly refused: readonly {
        readonly number: number;
        readonly title: string | null;
        readonly reason: ImportRefusalReasonPort;
        readonly path: string | null;
    }[];
    readonly uncategorised: number;
}

export interface ImportStatePort {
    readonly status: 'reading' | 'refused' | 'preview' | 'writing' | 'done' | 'failed';
    readonly fileName: string;
    readonly refusal: 'too-big' | 'not-geojson' | 'empty' | 'too-many' | 'unreadable' | 'places-unread' | null;
    readonly plan: ImportPlanPort | null;
    readonly fallbackCategory: string | null;
    readonly written: number;
    /** With `too-many`: the places the city has and the ones the file would add. */
    readonly limit?: { readonly existing: number; readonly adding: number } | null;
}

export interface PhotoChoicePort {
    readonly id: string;
    readonly title: PoiTextPort;
    readonly year: number | null;
    readonly thumb: string | null;
}

interface PoisFilterPort {
    readonly category: string | null;
    readonly unpublished: boolean;
    readonly search: string;
}

export interface PoisViewState {
    readonly filter: PoisFilterPort;
    readonly list: ListStatePort<PoiItemPort>;
    readonly categories: ListStatePort<CategoryItemPort>;
    readonly selection: readonly string[];
    readonly editor: PlaceEditorPort | null;
    readonly map: MapStatusPort;
    readonly clicked: { readonly id: string; readonly seq: number } | null;
    readonly photos: ListStatePort<PhotoChoicePort> | null;
    /** The open place's linked photos, each read by its id (the editor names them by title). */
    readonly linkedPhotos: readonly PhotoChoicePort[];
    /** Export all is reading the city's places. */
    readonly exporting: boolean;
    readonly importing: ImportStatePort | null;
    readonly busy: boolean;
    /** M4 (CR-M4-4): the open place's title suggestions and translation drafts. */
    readonly assist: AssistViewPort;
    /** The city's starting view once its document is read (Add at centre without a map needs it); null before. */
    readonly frame?: { readonly view: { readonly center: LngLat } } | null;
    /** M27: the city's old maps a street can be traced on, by year. */
    readonly traceLayers: readonly TraceLayerPort[];
    /** M27: the traced-on map's opacity under the drawing, in percent. */
    readonly traceOpacity: number;
}

export type VertexEditPort =
    | { readonly kind: 'set'; readonly index: number; readonly position: LngLat }
    | { readonly kind: 'move'; readonly index: number; readonly by: -1 | 1 }
    | { readonly kind: 'remove'; readonly index: number }
    | { readonly kind: 'add'; readonly index: number; readonly position: LngLat };

export type BulkActionPort =
    | { readonly kind: 'publish'; readonly published: boolean }
    | { readonly kind: 'move'; readonly category: string }
    | { readonly kind: 'delete' };

/** A file chosen in the page (a `File` is one). */
export interface ImportFilePort {
    readonly name: string;
    readonly size: number;
    text(): Promise<string>;
}

export interface PoisIntentsPort extends AssistActionsPort {
    setFilter(filter: Partial<PoisFilterPort>): void;
    more(): void;
    retry(): void;
    add(shape: PoiShapePort): string;
    edit(patch: PoiPatchPort): void;
    setTool(tool: 'select' | 'draw'): void;
    redraw(shape: PoiShapePort): void;
    selectVertex(index: number | null): void;
    editVertex(edit: VertexEditPort): boolean;
    addAtCentre(): boolean;
    undoLastVertex(): boolean;
    save(): Promise<unknown>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    remove(): Promise<{ readonly ok: boolean } | null>;
    /** The starter categories, for a city without any (finding 35 of 2026-11-01). */
    addStarterCategories(): Promise<unknown>;
    toggleSelected(id: string): void;
    selectAll(): void;
    clearSelection(): void;
    bulk(action: BulkActionPort): Promise<void>;
    loadPhotos(): void;
    morePhotos(): void;
    /** M27: fades the old map under the drawing (0..100 %). */
    setTraceOpacity(percent: number): void;
    chooseImport(file: ImportFilePort): Promise<void>;
    setImportCategory(category: string): void;
    commitImport(): Promise<void>;
    closeImport(): void;
    /** Every place of the city, or the selection, as a file; null (the area said why) when they could not be read. */
    exportPlaces(onlySelection: boolean): Promise<{ readonly name: string; readonly type: string; readonly text: string } | null>;
    attachMap(container: HTMLElement): void;
    detachMap(): void;
    zoomBy(delta: number): void;
}

export type PoisAreaPort = AreaPort<PoisViewState, PoisIntentsPort>;
