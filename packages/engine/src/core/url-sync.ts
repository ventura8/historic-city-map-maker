/**
 * The URL hash and the viewer state (docs/ENGINE_API.md → URL hash v1), through the codec of @hcm/shared. Reading
 * applies a decoded hash to the state (unknown ids ignored, opacities clamped by the codec and the overlay model);
 * writing encodes what differs from the manifest defaults and replaces the hash at most once per `HASH_WRITE_DELAY_MS`
 * (`history.replaceState`, so the back button is not flooded while the map moves).
 */
import {
    encodeHash,
    hashOverlayOpacity,
    PHOTOS_OVERLAY_ID,
    withHashOpacity,
    type CompareState,
    type DecodedHash,
    type HashLimits,
    type HashState,
    type ViewerLocale,
    type Manifest,
} from '@hcm/shared';

import { hashMapLabels, withHashLabels } from './map-labels.js';
import { isCompareLayer, withStory, withVisibleLayers, type CompareView, type ViewerState } from './state.js';
import { frontOfIds, hashLayerIds } from './stack.js';
import { yearOfLayers } from './timeline.js';

/** How long the hash waits for the map to settle before it is written. */
export const HASH_WRITE_DELAY_MS = 300;

/** The ranges a hash of this city is read with: its zoom range, its bounds, its overlay ids. */
export function hashLimits(manifest: Manifest): HashLimits {
    const categories = (manifest.poiCategories ?? []).map((category) => category.id);
    const overlayIds = new Set([...manifest.layers.map((layer) => layer.id), PHOTOS_OVERLAY_ID, ...categories]);
    return { minZoom: manifest.city.minZoom, maxZoom: manifest.city.maxZoom, bounds: manifest.city.bounds, overlayIds };
}

export interface AppliedHash {
    readonly state: ViewerState;
    /** A `photo=` id the manifest does not have (the viewer shows `error.unknownPhoto`). */
    readonly unknownPhoto: string | null;
    /** M17: a `story=` id the manifest does not have (`error.unknownStory`). */
    readonly unknownStory?: string;
}

/** The toast a hash's unknown photo or story asks for, or null. */
export function unknownToast(applied: AppliedHash): 'error.unknownPhoto' | 'error.unknownStory' | null {
    if (applied.unknownPhoto !== null) {
        return 'error.unknownPhoto';
    }
    return applied.unknownStory === undefined ? null : 'error.unknownStory';
}

/**
 * M17: `story=` opens the story, at its year; an id the manifest does not have opens nothing. A link that also carries
 * `layers=` is the sender's view (they moved the timeline with the story open), so its layers and their year stay.
 */
function withHashStory(applied: AppliedHash, hash: DecodedHash): AppliedHash {
    if (hash.story === undefined) {
        return applied;
    }
    const state = withStory(applied.state, hash.story);
    if (state === null) {
        return { ...applied, unknownStory: hash.story };
    }
    const { year, front, overlays } = applied.state;
    const kept = hash.layers === undefined ? state : { ...state, year, front, overlays };
    return { ...applied, state: kept };
}

function withHashLayers(state: ViewerState, layers: readonly string[] | undefined): ViewerState {
    if (layers === undefined || state.manifest === null) {
        return state;
    }
    const overlays = withVisibleLayers(state.overlays, new Set(layers));
    return { ...state, overlays, ...frontOfIds(state.manifest.layers, layers) };
}

function withHashPhoto(state: ViewerState, { photo, photoVersion }: DecodedHash): AppliedHash {
    if (photo === undefined) {
        return { state, unknownPhoto: null };
    }
    const known = state.manifest?.photos.some((candidate) => candidate.id === photo) === true;
    return known
        ? {
              state: { ...state, selectedPhotoId: photo, selectedPoiId: null, sheet: 'photo', photoVersion: photoVersion ?? null },
              unknownPhoto: null,
          }
        : { state, unknownPhoto: photo };
}

/**
 * Compare as the hash has it (M4, V06): `cmp=` naming today or a layer of the manifest opens it; without `cmp=`, or with
 * a layer the manifest does not have, compare is closed (the next hash write then drops `cmp` and `sw`).
 */
function hashCompare(state: ViewerState, compare: CompareState | undefined): CompareView | null {
    if (compare === undefined || state.manifest === null || !isCompareLayer(state.manifest, compare.layer)) {
        return null;
    }
    return { layerId: compare.layer, position: compare.position };
}

function withHashCompare(state: ViewerState, compare: CompareState | undefined): ViewerState {
    const next = hashCompare(state, compare);
    return next === null && state.compare === null ? state : { ...state, compare: next };
}

function withHashMapLabels(state: ViewerState, labels: DecodedHash['labels']): ViewerState {
    const mapLabels = withHashLabels(state.mapLabels, labels);
    return mapLabels === state.mapLabels ? state : { ...state, mapLabels };
}

/** `hash` applied to `state`: the view, the visible layers (and their year), the opacities, compare, the labels, the photo, the language. */
export function applyDecodedHash(state: ViewerState, hash: DecodedHash): AppliedHash {
    const withView = hash.view === undefined ? state : { ...state, view: hash.view, hashView: undefined };
    const withLayers = withHashMapLabels(withHashCompare(withHashLayers(withView, hash.layers), hash.compare), hash.labels);
    const overlays = withHashOpacity(withLayers.overlays, hash);
    const withNear = hash.photosNear === undefined ? withLayers : { ...withLayers, photosNear: hash.photosNear };
    const withLang = hash.lang === undefined ? withNear : { ...withNear, locale: hash.lang };
    return withHashStory(withHashPhoto(overlays === withLang.overlays ? withLang : { ...withLang, overlays }, hash), hash);
}

/**
 * `layers=` only when the visible historical layers, or the one on top, differ from the manifest's defaults; the layer on
 * top is named last (V15, `stack.ts`).
 */
function hashLayers(state: ViewerState): Pick<HashState, 'layers'> {
    const layers = state.manifest?.layers ?? [];
    const overlays = state.overlays.map((overlay) => ({ ...overlay, visible: overlay.defaultVisible }));
    const visible = overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible).map((overlay) => overlay.id);
    const defaults = { layers, overlays, year: yearOfLayers(layers, visible), front: null };
    const ids = hashLayerIds({ layers, overlays: state.overlays, year: state.year, front: state.front, defaults });
    return ids === null ? {} : { layers: ids };
}

/** What the hash carries for `state`; `defaultLocale` (the page's language) is left out. */
export function hashStateOf(state: ViewerState, defaultLocale: ViewerLocale): HashState {
    const overlayOpacity = hashOverlayOpacity(state.overlays);
    return {
        view: hashViewOf(state),
        ...hashLayers(state),
        ...(overlayOpacity === undefined ? {} : { overlayOpacity }),
        ...(state.compare === null ? {} : { compare: { layer: state.compare.layerId, position: state.compare.position } }),
        ...hashMapLabels(state.mapLabels),
        ...(state.photosNear === null ? {} : { photosNear: state.photosNear }),
        ...photoOf(state),
        ...storyOf(state),
        ...(state.locale === defaultLocale ? {} : { lang: state.locale }),
    };
}

/** `photo=` while a photo is open, and `pv=` with it once the visitor picked a version. */
function photoOf({ selectedPhotoId: photo, photoVersion }: ViewerState): Pick<HashState, 'photo' | 'photoVersion'> {
    if (photo === null) {
        return {};
    }
    return photoVersion === null ? { photo } : { photo, photoVersion };
}

/** The view the hash carries: the one it kept while the camera is at the visitor's position (`store.flyTo`), else the camera's. */
function hashViewOf(state: ViewerState): ViewerState['view'] {
    return state.hashView ?? state.view;
}

/** M17: `story=` while a story is open. */
function storyOf(state: ViewerState): Pick<HashState, 'story'> {
    return state.sheet === 'stories' && state.selectedStoryId !== null ? { story: state.selectedStoryId } : {};
}

export interface HashLocation {
    readonly hash: string;
    replaceHash(hash: string): void;
}

/**
 * Writes the hash at most once per `HASH_WRITE_DELAY_MS`, with the state of the moment it is written. A hash the
 * visitor (or the browser's history) put in the address since the last write or `sync` is never overwritten: its
 * `hashchange` is on its way and wins (the e2e run of S-V11-HAPPY lost a `photo=` that way).
 */
export class HashWriter {
    readonly #location: HashLocation;
    readonly #encode: () => string;
    #timer: ReturnType<typeof setTimeout> | null = null;
    /** The address's hash as this writer last wrote or adopted it. */
    #known: string;

    constructor(location: HashLocation, encode: () => string) {
        this.#location = location;
        this.#encode = encode;
        this.#known = location.hash;
    }

    /** Adopts the address's hash as it is now (the store is about to apply it). */
    sync(): void {
        this.#known = this.#location.hash;
    }

    schedule(): void {
        this.#timer ??= setTimeout(() => {
            this.#timer = null;
            this.flush();
        }, HASH_WRITE_DELAY_MS);
    }

    /** Writes now (a legacy hash is rewritten at once); an unchanged hash is not written again. */
    flush(): void {
        this.cancel();
        if (this.#location.hash !== this.#known) {
            this.sync();
            return;
        }
        const hash = this.#encode();
        if (hash !== this.#location.hash) {
            this.#location.replaceHash(hash);
            this.sync();
        }
    }

    cancel(): void {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }
}

/** The encoded hash of `state` (`''` before the manifest loads: nothing to share yet). */
export function encodeViewerHash(state: ViewerState, defaultLocale: ViewerLocale): string {
    return state.manifest === null ? '' : encodeHash(hashStateOf(state, defaultLocale));
}
