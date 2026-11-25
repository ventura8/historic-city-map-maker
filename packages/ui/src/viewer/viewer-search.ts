/**
 * Static manifest search for the public viewer: finds places, POIs, disappeared streets, photos and stories by name
 * from the already-loaded `Manifest` (no Firestore, no network beyond the manifest). Matches are diacritics-insensitive
 * across both Romanian (`ro`) and English (`en`) titles, with prefix matches ranked ahead of substring matches.
 */
import {
    DEFAULT_POI_ICON,
    geometryPositions,
    localized,
    translate,
    type Geometry,
    type LngLat,
    type Manifest,
    type Photo,
    type Poi,
    type PoiCategory,
    type Story,
    type ViewerLocale,
} from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { ViewerStorePort } from './store-port.js';
import { localizedText, photoDateText, type DataText } from './text.js';

type SearchResultKind = 'poi' | 'photo' | 'story';

export interface SearchResult {
    readonly id: string;
    readonly kind: SearchResultKind;
    readonly title: string;
    readonly subtitle: string;
    readonly center: LngLat | null;
    readonly icon: string;
    readonly categoryId?: string | undefined;
}

const MAX_SEARCH_RESULTS = 20;
const SEARCH_ZOOM = 16;

/** Strips diacritics (including Romanian comma-below ș/ț), lowercases and trims. */
export function normalizeSearchText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/** Bounding-box midpoint of any POI geometry (`Point`, `LineString`, `Polygon`). */
export function geometryCenter(geometry: Geometry): LngLat {
    const positions = geometryPositions(geometry);
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of positions) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    }
    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

/** 2 for a prefix match, 1 for a substring match, 0 for no match, across both `ro` and `en`. */
function matchScore(title: DataText, needle: string): number {
    const candidates = title.en === undefined ? [title.ro] : [title.ro, title.en];
    let best = 0;
    for (const candidate of candidates) {
        const normalized = normalizeSearchText(candidate);
        if (normalized.startsWith(needle)) {
            return 2;
        }
        if (normalized.includes(needle)) {
            best = 1;
        }
    }
    return best;
}

interface ScoredResult {
    readonly score: number;
    readonly result: SearchResult;
}

function poiResult(poi: Poi, categories: ReadonlyMap<string, PoiCategory>, locale: ViewerLocale): SearchResult {
    const category = categories.get(poi.category);
    const subtitle = category === undefined ? translate(locale, 'search.kind.poi') : localized(category.label, locale);
    return {
        id: poi.id,
        kind: 'poi',
        title: localizedText(poi.title, locale),
        subtitle,
        center: geometryCenter(poi.geometry),
        icon: category?.icon ?? DEFAULT_POI_ICON,
        categoryId: poi.category,
    };
}

function photoResult(photo: Photo, locale: ViewerLocale): SearchResult {
    return {
        id: photo.id,
        kind: 'photo',
        title: localizedText(photo.title, locale),
        subtitle: `${translate(locale, 'search.kind.photo')} · ${photoDateText(photo, locale)}`,
        center: [photo.location.lng, photo.location.lat],
        icon: 'photo_camera',
    };
}

function firstPoiCenter(story: Story, manifest: Manifest): LngLat | null {
    const id = story.poiIds?.[0];
    const poi = id === undefined ? undefined : (manifest.pois ?? []).find((candidate) => candidate.id === id);
    return poi === undefined ? null : geometryCenter(poi.geometry);
}

function firstPhotoCenter(story: Story, manifest: Manifest): LngLat | null {
    const id = story.photoIds?.[0];
    const photo = id === undefined ? undefined : manifest.photos.find((candidate) => candidate.id === id);
    return photo === undefined ? null : [photo.location.lng, photo.location.lat];
}

/** A story's place on the map: its first place, else its first photo, else none. */
function storyCenter(story: Story, manifest: Manifest): LngLat | null {
    return firstPoiCenter(story, manifest) ?? firstPhotoCenter(story, manifest);
}

function storyResult(story: Story, manifest: Manifest, locale: ViewerLocale): SearchResult {
    return {
        id: story.id,
        kind: 'story',
        title: localizedText(story.title, locale),
        subtitle: translate(locale, 'search.kind.story'),
        center: storyCenter(story, manifest),
        icon: 'museum',
    };
}

function collectPois(manifest: Manifest, needle: string, locale: ViewerLocale): ScoredResult[] {
    const categories = new Map((manifest.poiCategories ?? []).map((cat) => [cat.id, cat]));
    const out: ScoredResult[] = [];
    for (const poi of manifest.pois ?? []) {
        const score = matchScore(poi.title, needle);
        if (score > 0) {
            out.push({ score, result: poiResult(poi, categories, locale) });
        }
    }
    return out;
}

function collectPhotos(manifest: Manifest, needle: string, locale: ViewerLocale): ScoredResult[] {
    const out: ScoredResult[] = [];
    for (const photo of manifest.photos) {
        const score = matchScore(photo.title, needle);
        if (score > 0) {
            out.push({ score, result: photoResult(photo, locale) });
        }
    }
    return out;
}

function collectStories(manifest: Manifest, needle: string, locale: ViewerLocale): ScoredResult[] {
    const out: ScoredResult[] = [];
    for (const story of manifest.stories ?? []) {
        const score = matchScore(story.title, needle);
        if (score > 0) {
            out.push({ score, result: storyResult(story, manifest, locale) });
        }
    }
    return out;
}

/** Searches POIs (including disappeared streets), photos and stories in `manifest` by name. */
export function searchManifest(
    manifest: Manifest,
    query: string,
    locale: ViewerLocale,
    limit: number = MAX_SEARCH_RESULTS,
): readonly SearchResult[] {
    const needle = normalizeSearchText(query);
    if (needle === '') {
        return [];
    }
    const scored = [
        ...collectPois(manifest, needle, locale),
        ...collectPhotos(manifest, needle, locale),
        ...collectStories(manifest, needle, locale),
    ];
    scored.sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title, locale));
    return scored.slice(0, limit).map((entry) => entry.result);
}

function flyToResult(store: ViewerStorePort, center: LngLat): void {
    const state = store.getState();
    const maxZoom = state.manifest?.city.maxZoom ?? SEARCH_ZOOM;
    const zoom = Math.max(state.view.zoom, Math.min(SEARCH_ZOOM, maxZoom));
    store.flyTo({ ...state.view, center, zoom });
}

function openPoiResult(store: ViewerStorePort, result: SearchResult): void {
    if (result.categoryId !== undefined) {
        store.toggleOverlay(result.categoryId, true);
    }
    store.openPoi(result.id);
}

/** Flies the map to `result` (when it has coordinates) and opens its detail sheet. */
export function selectSearchResult(store: ViewerStorePort, result: SearchResult): void {
    if (result.center !== null) {
        flyToResult(store, result.center);
    }
    if (result.kind === 'photo') {
        store.openPhoto(result.id);
    } else if (result.kind === 'poi') {
        openPoiResult(store, result);
    } else {
        store.openStory(result.id);
    }
}

/** The viewer handler `<hcm-search>` calls. */
export interface SearchHandlers {
    /** A search result picked from `<hcm-search>`. */
    readonly onSearchSelect: (event: CustomEvent<{ readonly result: SearchResult }>) => void;
}

/** The search bar's dock, at the top of the map; none without a map, where the photo list takes the page (lesson 804). */
export function searchDock(webgl: boolean, manifest: Manifest, locale: ViewerLocale, handlers: SearchHandlers): TemplateResult {
    if (!webgl) {
        return EMPTY;
    }
    return html`<div class="dock search">
        <hcm-search
            data-layout-check="search"
            .manifest=${manifest}
            .locale=${locale}
            @hcm-search-select=${handlers.onSearchSelect}
        ></hcm-search>
    </div>`;
}

/** `hcm-search-select`: the picked result's flight and sheet. */
export function pickSearchResult(store: ViewerStorePort, event: CustomEvent<{ readonly result: SearchResult }>): void {
    selectSearchResult(store, event.detail.result);
}
