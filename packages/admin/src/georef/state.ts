/**
 * The georeferencer's state and intents (`docs/research/M3-interfaces.md` §10.4): the version it opens (its scan, its
 * reference, whether it takes points), the pairs being edited and the half pair, the transform and its fit, the city's
 * threshold, Save, the reference shown, the warped preview, the map and, on compact windows, which pane shows.
 */
import type { MapPort } from '@hcm/ui/map';
import {
    bboxFromRecord,
    imagerySettingsOf,
    type BBox,
    type CropRing,
    type Gcp,
    type GeorefTransform,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { DocState } from '../content/doc.js';
import type { MapStatus } from '../layers/map-session.js';
import type { NoticeInput } from '../state/state.js';
import type { FitView } from './fit-view.js';
import type { ScanCamera } from './linked-views.js';
import type { Ghost } from './ghost.js';
import type { GeoPosition, HalfPair, PixelPosition } from './pairs.js';
import { NO_SUGGESTIONS, type SuggestionsView } from './suggestions.js';

export type ReferenceKind = 'osm' | 's2';

/** The states in which a version takes new points (`imagery.saveGcps`): it waits for them, or it has a render. */
const EDITABLE_STATES: readonly LayerVersionState[] = ['needs_gcps', 'awaiting_approval', 'published'];

export interface GeorefVersion {
    readonly id: string;
    readonly layerId: string;
    readonly label: LayerVersionDoc['label'];
    readonly state: LayerVersionState;
    readonly scan: {
        readonly width: number;
        readonly height: number;
        readonly previewScale: number;
        readonly previewPath: string;
        /** The sharper scan (`scan-tiles.bin`) and its pixels per scan pixel; null: none (a short scan, or an older version). */
        readonly detail: { readonly path: string; readonly scale: number } | null;
        /** A series' joined sheets: the layout's revision, which a relayout raises over the same preview path. */
        readonly revision?: number;
    } | null;
    readonly reference: {
        readonly bounds: BBox;
        readonly osmPath: string | null;
        readonly s2Path: string | null;
        readonly s2Date: string | null;
    } | null;
    readonly crop: CropRing | null;
    readonly editable: boolean;
    /** Where the city likely lies in the scan (its pixels), for the scan pane to open on; null: the whole scan (admin sweep 2026-11-14). */
    readonly opening: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
    /**
     * M20 §19.13: an archive series (its scan pane says what to do when it has no picture), and whether the picture shown is only its
     * joined sheets (`help.stitched`, shown to check, no points saved on it: Fix the tiles makes a version with a scan).
     */
    readonly series?: { readonly stitchedOnly: boolean };
}

function referenceOf(reference: LayerVersionDoc['reference']): GeorefVersion['reference'] {
    if (reference === undefined) {
        return null;
    }
    const { osmPath = null, s2Path = null, s2Date = null } = reference;
    return { bounds: bboxFromRecord(reference.bounds), osmPath, s2Path, s2Date };
}

function scanOf(scan: LayerVersionDoc['scan']): GeorefVersion['scan'] {
    if (scan === undefined) {
        return null;
    }
    const { width, height, previewScale, previewPath, detailPath, detailScale } = scan;
    const detail = detailPath === undefined ? null : { path: detailPath, scale: detailScale ?? 1 };
    return { width, height, previewScale, previewPath, detail };
}

/** M20 §19.13: an archive series with no scan shows its joined sheets (`help.stitched`), when it has them, to check by eye. */
function stitchedScanOf(version: LayerVersionDoc): GeorefVersion['scan'] {
    const stitched = version.help?.stitched;
    if (stitched === undefined) {
        return null;
    }
    const { width, height, previewScale, previewPath, layout } = stitched;
    const revision = layout === undefined ? {} : { revision: layout.revision };
    return { width, height, previewScale, previewPath, detail: null, ...revision };
}

/** An archive series' flags, or none for any other version. */
function seriesOf(version: LayerVersionDoc): Pick<GeorefVersion, 'series'> {
    return version.origin === 'archive'
        ? { series: { stitchedOnly: version.scan === undefined && version.help?.stitched !== undefined } }
        : {};
}

/** The picture the scan pane shows and whether points are saved on it: the scan, or a series' joined sheets to check by eye. */
function pictureOf(version: LayerVersionDoc, series: GeorefVersion['series']): Pick<GeorefVersion, 'scan' | 'editable'> {
    if (series?.stitchedOnly === true) {
        return { scan: stitchedScanOf(version), editable: false };
    }
    return { scan: scanOf(version.scan), editable: EDITABLE_STATES.includes(version.state) };
}

export function georefVersionOf(id: string, version: LayerVersionDoc): GeorefVersion {
    const series = seriesOf(version);
    return {
        ...{ id, layerId: version.layerId, label: version.label, state: version.state },
        ...pictureOf(version, series.series),
        ...{ reference: referenceOf(version.reference), crop: version.crop ?? null },
        opening: version.calibration?.expected?.[0] ?? null,
        ...series,
    };
}

/** A point picked up from the context menu. */
interface Moving {
    readonly id: string;
    readonly pane: 'scan' | 'map';
}

/** What the context menu finds under a point of the map. */
export interface MapTarget {
    readonly geo: GeoPosition;
    readonly hit: string | null;
}

export type ScanImage = { readonly status: 'none' | 'loading' | 'failed' } | { readonly status: 'ready'; readonly url: string };

/** The sharper scan for a zoomed-in pane (its tiles' file, `scan-tiles.bin`) and its pixels per scan pixel. */
export interface ScanDetail {
    readonly file: Blob;
    readonly scale: number;
}

/** A published layer the map pane can show under the pairs. */
export interface BaseLayerItem {
    readonly id: string;
    readonly label: LayerVersionDoc['label'];
    readonly year: number;
}

export interface GeorefState {
    readonly versionId: string | null;
    readonly doc: Omit<DocState<never>, 'doc'>;
    /** Read, and no such version. */
    readonly notFound: boolean;
    readonly version: GeorefVersion | null;
    /** The scan preview for the scan pane (a `blob:` address). */
    readonly scan: ScanImage;
    /** The sharper scan, fetched once the pane zooms past the preview's own pixels (null: not yet, or none). */
    readonly scanDetail: ScanDetail | null;
    /** The reference shown on the map (null: the version has none). */
    readonly reference: ReferenceKind | null;
    readonly pairs: readonly Gcp[];
    /** "Add pairs" is on: a click on the scan or the map is one end of the next pair. */
    readonly adding: boolean;
    readonly half: HalfPair | null;
    /** Where the pairs so far expect the half pair's other end (a dashed ring on the other pane; null: none). */
    readonly ghost: Ghost | null;
    /** The context menu's Move this point: the pair whose end on `pane` the next click drops there (Esc cancels). */
    readonly moving: Moving | null;
    readonly selected: string | null;
    readonly transform: GeorefTransform;
    readonly fit: FitView;
    readonly thresholdM: number;
    /** The pairs or the transform differ from the version's. */
    readonly dirty: boolean;
    /** Undo has a remembered pair edit to take back (up to 50 since open or Discard). */
    readonly canUndo: boolean;
    readonly saving: boolean;
    readonly refusal: NoticeInput | null;
    /** The version Save started or continued (the page opens it). */
    readonly saved: string | null;
    readonly showPreview: boolean;
    /** The warped preview's opacity, 0 to 1. */
    readonly previewOpacity: number;
    readonly map: MapStatus;
    /** On compact windows, the pane shown: the scan or the map. */
    readonly pane: 'scan' | 'map';
    /** The matcher's suggestions still to decide (M4 §2.5). */
    readonly suggestions: SuggestionsView;
    /** Link the views: once a fit exists, moving one pane moves the other (on by default; kept while the admin is open). */
    readonly linked: boolean;
    /** Where the linked map last put the scan pane (a new object each time; the pane moves without answering). */
    readonly scanFollow: ScanCamera | null;
    /** The panes turn together once a fit exists (on by default; kept while the admin is open). */
    readonly rotateLinked: boolean;
    /** How far the scan pane is turned, radians clockwise (as it last said, or as the linked map last turned it). */
    readonly scanAngle: number;
    /** The city's published layers, oldest first: what the map pane can show besides the reference. */
    readonly baseLayers: readonly BaseLayerItem[];
    /** The published layer the map pane shows under the pairs (null: the reference alone); kept while the admin is open. */
    readonly base: string | null;
}

const EMPTY_FIT: FitView = {
    ...{ refusal: 'too-few', fitRmseM: null, checkpointRmseM: null, checkpointCount: 0, residuals: {} },
    ...{ missing: { affine: 3, poly2: 6, tps: 10 }, overThreshold: false, refitted: false },
};

export const INITIAL_GEOREF: GeorefState = {
    ...{ versionId: null, doc: { status: 'loading', reconnecting: false, failure: null }, notFound: false, version: null },
    ...{ scan: { status: 'none' }, scanDetail: null, reference: null, pairs: [], adding: false, half: null, ghost: null },
    ...{ moving: null, selected: null },
    ...{
        fit: EMPTY_FIT,
        thresholdM: imagerySettingsOf(undefined).rmseThresholdM,
        dirty: false,
        canUndo: false,
        saving: false,
        refusal: null,
    },
    ...{ transform: 'affine', saved: null, showPreview: true, previewOpacity: 0.7, map: 'none', pane: 'scan', suggestions: NO_SUGGESTIONS },
    ...{ linked: true, scanFollow: null, baseLayers: [], base: null, rotateLinked: true, scanAngle: 0 },
};

export interface GeorefIntents {
    retry(): void;
    /** "Add pairs": on, each pair is a click on the scan and one on the map (either first); off, the points move. */
    setAdding(adding: boolean): void;
    /** A click on the scan, in full-resolution scan pixels. */
    pickScan(pixel: PixelPosition): void;
    /** The keyboard's way: a pair at the scan's crosshair and the map's centre. */
    addAtCentres(pixel: PixelPosition): void;
    movePixel(id: string, pixel: PixelPosition): void;
    moveGeo(id: string, geo: GeoPosition): void;
    select(id: string | null): void;
    remove(id: string): void;
    /** Enabled ↔ checkpoint. */
    toggle(id: string): void;
    /** Esc: a picked-up point is put back, else the half pair is dropped, else the selection. */
    cancelHalf(): void;
    /** The context menu's Add a point here: Add pairs on, then that end exactly as a click there. */
    addAt(end: HalfPair): void;
    /** The context menu's Move this point: the pair's end on `pane` follows the next click there. */
    pickUp(id: string, pane: Moving['pane']): void;
    /** The place and the pair under a point of the map's box (CSS px from its corner); null without a map. */
    mapTarget(point: PixelPosition): MapTarget | null;
    /** Accept: the suggestion joins the pairs (enabled, `auto`); saved only with Save. */
    acceptSuggestion(id: string): void;
    /** Accept all: every suggestion still to decide joins the pairs. */
    acceptAllSuggestions(): void;
    /** Reject: the suggestion is hidden for this visit of the page. */
    rejectSuggestion(id: string): void;
    /** The suggestion the panes show larger (null: none). */
    selectSuggestion(id: string | null): void;
    setTransform(kind: GeorefTransform): void;
    setReference(kind: ReferenceKind): void;
    /** The map pane shows a published layer under the pairs (null: the reference alone). */
    setBase(id: string | null): void;
    setPreviewOpacity(percent: number): void;
    togglePreview(show: boolean): void;
    setPane(pane: 'scan' | 'map'): void;
    /** `imagery.saveGcps`: true when the job was queued (the page opens the version). */
    save(): Promise<boolean>;
    /** M16: Snap my points (`snap.ts`). */
    snap(): Promise<boolean>;
    discard(): void;
    /** The last change to the pairs taken back, one step at a time. */
    undo(): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    /** Map pane keyboard focus: badge crosshair matches the scan. */
    setMapFocus(focused: boolean): void;
    /** Arrow nudge of the selected pair in screen CSS px (same as the scan). */
    nudgeMap(dx: number, dy: number): void;
    /** Link the views on or off. */
    setLinked(linked: boolean): void;
    /** The owner panned, zoomed or turned the scan pane: the linked map follows. */
    scanMoved(camera: ScanCamera): void;
    /** The panes turn together, or each on its own. */
    setRotateLinked(linked: boolean): void;
    compassMap?(): MapPort | null;
    /** Turns the map by `degrees` clockwise on the screen; null: north up. */
    rotateMap(degrees: number | null): void;
}
