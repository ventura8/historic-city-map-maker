/**
 * URL-hash codec v1 of the public viewer (docs/ENGINE_API.md → URL hash).
 *
 *     #<zoom>/<lat>/<lng>[/<bearing>][&layers=<id>,<id>][&opacity=<0..1>][&op=<id>:<0..100>,...][&cmp=<id>][&sw=<0..100>]
 *         [&labels=streets,pois][&near=5|10|25][&photo=<id>][&pv=original|improved|colorized][&story=<id>][&lang=<one of VIEWER_LOCALES>]
 *
 * Decoding is defensive: the hash is visitor input. Numbers must be plain decimals, every range is
 * clamped, ids must match `ID_PATTERN` (anything else is dropped, never put into a selector), unknown
 * parameters are ignored and a hash longer than `MAX_HASH_LENGTH` is ignored as a whole. `op=` carries the opacity
 * of each overlay in percent (PLAN Addendum 3: historical layers, `photos`, POI categories); given the manifest's
 * overlay ids, the decoder also drops the entries of unknown overlays. `cmp=` opens swipe compare (M4, scenario V06) with
 * the layer the second side shows (empty: today, no historical layer) and `sw=` places its divider in percent of the
 * map's width; `sw=` without `cmp=` is ignored, and either may come first. `labels=` names the basemap's labels that are
 * drawn (empty: none); `near=` shows only the photos within that many years of the selected year (5, 10 or 25; any other
 * value is ignored); `pv=` is the version of the open photo the visitor picked (only with `photo=`; any other word reads
 * as `original`); `story=` opens a story (M17, `docs/research/M17-stories.md` §5); an unknown word is ignored, and a value with nothing but unknown words is ignored as a whole. The legacy
 * hash of the 2015–2022 site, `#zoom/lat/lng/rotation/!a3!p2`, decodes to its map view; its layer
 * codes (`!…`) are ignored and `legacy` tells the viewer to rewrite the hash in the v1 form.
 */
import { clampToBBox, type BBox } from '../geo/bbox.js';
import { clamp, MAX_MERCATOR_LAT, roundTo, wrapBearing, type LngLat } from '../geo/math.js';
import { VIEWER_LOCALES, type ViewerLocale } from '../i18n/index.js';
import { MAP_LABEL_KINDS, type MapLabels } from '../overlays/map-labels.js';
import { PHOTOS_NEAR_WINDOWS } from '../overlays/photos.js';
import { PHOTO_VIEWS, type PhotoView } from '../schemas/manifest.js';
import { isId } from '../schemas/primitives.js';

/** Hashes longer than this are ignored (a link that long was not made by the viewer). */
export const MAX_HASH_LENGTH = 2048;

/** At most this many overlay opacities are read from one `op=` parameter. */
export const MAX_OVERLAY_ENTRIES = 50;

export interface MapView {
    readonly center: LngLat;
    readonly zoom: number;
    /** Degrees clockwise from north, `[0, 360)`. */
    readonly bearing: number;
}

/**
 * Swipe compare (M4, scenario V06; docs/ENGINE_API.md → *Compare*): the layer the compared side shows (`null`: today, no
 * historical layer) and where the divider stands, from 0 (the compared side fills the map) to 1 (the main side fills it).
 * On a compact window the same state is a toggle: 0 shows the compared side, anything else the main one.
 */
export interface CompareState {
    readonly layer: string | null;
    readonly position: number;
}

/** The divider's place when the hash opens compare without `sw=`: the middle of the map. */
export const DEFAULT_COMPARE_POSITION = 0.5;

/** Everything the hash can carry; an absent field means "not in the hash", so the viewer keeps its default. */
export interface HashState {
    readonly view?: MapView;
    /** Visible historical layers; `[]` means "none" (`&layers=`). */
    readonly layers?: readonly string[];
    /** Opacity of the visible historical layers, `[0, 1]` (the V05 slider). */
    readonly opacity?: number;
    /** Per-overlay opacity, `[0, 1]`, keyed by overlay id (PLAN Addendum 3); wins over `opacity`. */
    readonly overlayOpacity?: Readonly<Record<string, number>>;
    /** M4: swipe compare is open (V06); absent when it is not. */
    readonly compare?: CompareState;
    /** The basemap's labels that are drawn; absent means the city's default. */
    readonly labels?: MapLabels;
    /** Only the photos within this many years of the selected year are drawn; absent: every photo. */
    readonly photosNear?: number;
    readonly photo?: string;
    /** The version of the open photo the visitor picked; absent: the photo's default (improved, else the original). */
    readonly photoVersion?: PhotoView;
    /** M17: the open story. */
    readonly story?: string;
    readonly lang?: ViewerLocale;
}

export interface DecodedHash extends HashState {
    /** True when the hash had the legacy `!…` layer codes: rewrite it with `encodeHash`. */
    readonly legacy: boolean;
}

/** Ranges the decoded view is clamped to; the viewer passes the city's zoom range and bounds. */
export interface HashLimits {
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly bounds?: BBox;
    /**
     * The manifest's overlay ids (layer ids, `photos`, POI category ids): with it, an `op=` entry for any other id is
     * dropped while decoding. Without it every well-formed id is kept (the overlay model ignores unknown ones).
     */
    readonly overlayIds?: ReadonlySet<string>;
}

export const DEFAULT_HASH_LIMITS: HashLimits = { minZoom: 0, maxZoom: 22 };

const DECIMAL = /^-?\d{1,4}(?:\.\d{1,12})?$/;

/** A plain decimal (`-12.5`, `14`), or null for anything else (`1e3`, `Infinity`, `0x10`, blanks). */
function parseDecimal(text: string): number | null {
    return DECIMAL.test(text) ? Number(text) : null;
}

// ---- encoding -----------------------------------------------------------------------------------

function encodeView(view: MapView): string {
    const position = [roundTo(view.zoom, 2), roundTo(view.center[1], 5), roundTo(view.center[0], 5)].map(String).join('/');
    const bearing = roundTo(wrapBearing(view.bearing), 1);
    return bearing === 0 ? position : `${position}/${String(bearing)}`;
}

/** At most `MAX_OVERLAY_ENTRIES` entries, the most the decoder reads back. */
function encodeOverlays(overlays: Readonly<Record<string, number>>): string | null {
    const entries = Object.entries(overlays)
        .filter(([id]) => isId(id))
        .slice(0, MAX_OVERLAY_ENTRIES)
        .map(([id, value]) => `${id}:${String(Math.round(clamp(value, 0, 1) * 100))}`);
    return entries.length === 0 ? null : `op=${entries.join(',')}`;
}

/** `cmp=<id>` (empty for today) and, when the divider is not in the middle, `sw=<percent>`; an invalid id writes nothing. */
function encodeCompare(compare: CompareState): string | null {
    if (compare.layer !== null && !isId(compare.layer)) {
        return null;
    }
    const percent = Math.round(clamp(compare.position, 0, 1) * 100);
    const layer = `cmp=${compare.layer ?? ''}`;
    return percent === DEFAULT_COMPARE_POSITION * 100 ? layer : `${layer}&sw=${String(percent)}`;
}

/** `labels=` with the kinds that are drawn, in their fixed order; empty when none is. */
function encodeLabels(labels: MapLabels): string {
    return `labels=${MAP_LABEL_KINDS.filter((kind) => labels[kind]).join(',')}`;
}

type Encoder = (state: HashState) => string | null;

/** One encoder per field, in the order the parameters appear in the hash. */
const ENCODERS: readonly Encoder[] = [
    (state) => (state.view === undefined ? null : encodeView(state.view)),
    (state) => (state.layers === undefined ? null : `layers=${state.layers.filter((id) => isId(id)).join(',')}`),
    (state) => (state.opacity === undefined ? null : `opacity=${String(roundTo(clamp(state.opacity, 0, 1), 2))}`),
    (state) => (state.overlayOpacity === undefined ? null : encodeOverlays(state.overlayOpacity)),
    (state) => (state.compare === undefined ? null : encodeCompare(state.compare)),
    (state) => (state.labels === undefined ? null : encodeLabels(state.labels)),
    (state) => (state.photosNear === undefined ? null : `near=${String(state.photosNear)}`),
    (state) => (state.photo !== undefined && isId(state.photo) ? `photo=${state.photo}` : null),
    (state) => (state.photo === undefined || state.photoVersion === undefined ? null : `pv=${state.photoVersion}`),
    (state) => (state.story !== undefined && isId(state.story) ? `story=${state.story}` : null),
    (state) => (state.lang === undefined ? null : `lang=${state.lang}`),
];

/** The v1 hash for `state`, with its leading `#`, or `''` when there is nothing to encode. */
export function encodeHash(state: HashState): string {
    const parts = ENCODERS.map((encoder) => encoder(state)).filter((part) => part !== null);
    return parts.length === 0 ? '' : `#${parts.join('&')}`;
}

// ---- decoding -----------------------------------------------------------------------------------

function clampCenter(center: LngLat, limits: HashLimits): LngLat {
    const world: LngLat = [clamp(center[0], -180, 180), clamp(center[1], -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)];
    return limits.bounds === undefined ? world : clampToBBox(world, limits.bounds);
}

function isNumber(value: number | null): value is number {
    return value !== null;
}

/** The `zoom/lat/lng[/bearing]` segment (v1), or `zoom/lat/lng/rotation/!a3!p2` (legacy). */
function decodeView(segment: string, limits: HashLimits): { view?: MapView; legacy: boolean } {
    const parts = segment.split('/');
    const legacy = parts.some((part) => part.startsWith('!'));
    const numbers = parts.filter((part) => !part.startsWith('!')).map(parseDecimal);
    if (numbers.length < 3 || numbers.length > 4 || !numbers.every(isNumber)) {
        return { legacy };
    }
    // Three or four plain decimals, checked just above.
    const [zoom, lat, lng, bearing] = numbers as [number, number, number, number?];
    const view: MapView = {
        zoom: clamp(zoom, limits.minZoom, limits.maxZoom),
        center: clampCenter([lng, lat], limits),
        bearing: wrapBearing(bearing ?? 0),
    };
    return { view, legacy };
}

function decodeIds(value: string): string[] {
    return [...new Set(value.split(',').filter((id) => isId(id)))];
}

function decodeOverlayEntry(entry: string): [string, number] | null {
    const [id, percent, ...extra] = entry.split(':');
    const value = percent === undefined || extra.length > 0 ? null : parseDecimal(percent);
    return isId(id) && value !== null ? [id, clamp(value, 0, 100) / 100] : null;
}

function isKnownOverlay(entry: [string, number] | null, known: ReadonlySet<string> | undefined): entry is [string, number] {
    return entry !== null && (known === undefined || known.has(entry[0]));
}

function decodeOverlays(value: string, limits: HashLimits): Partial<HashState> {
    const entries = value
        .split(',')
        .slice(0, MAX_OVERLAY_ENTRIES)
        .map(decodeOverlayEntry)
        .filter((entry) => isKnownOverlay(entry, limits.overlayIds));
    return entries.length === 0 ? {} : { overlayOpacity: Object.fromEntries(entries) };
}

/** What the parameters decode to before `cmp=` and `sw=` are put together into `compare` (either may come first). */
interface Decoding extends DecodedHash {
    readonly compareLayer?: string | null;
    readonly comparePosition?: number;
}

/** `cmp=`: a layer id, or empty for today; anything else is ignored. */
function decodeCompareLayer(value: string): Partial<Decoding> {
    if (value === '') {
        return { compareLayer: null };
    }
    return isId(value) ? { compareLayer: value } : {};
}

/** `sw=`: the divider in percent of the map's width, clamped to `[0, 100]`. */
function decodeComparePosition(value: string): Partial<Decoding> {
    const percent = parseDecimal(value);
    return percent === null ? {} : { comparePosition: clamp(percent, 0, 100) / 100 };
}

/** `compare` from `cmp=` and `sw=`; without `cmp=` there is no compare, whatever `sw=` says. */
function withCompare({ compareLayer, comparePosition, ...state }: Decoding): DecodedHash {
    if (compareLayer === undefined) {
        return state;
    }
    return { ...state, compare: { layer: compareLayer, position: comparePosition ?? DEFAULT_COMPARE_POSITION } };
}

function decodeOpacity(value: string): Partial<HashState> {
    const opacity = parseDecimal(value);
    return opacity === null ? {} : { opacity: clamp(opacity, 0, 1) };
}

/** `labels=`: the kinds it names; empty is none, and a value naming no kind this viewer knows is ignored. */
function decodeLabels(value: string): Partial<HashState> {
    const words = value.split(',');
    if (value !== '' && !MAP_LABEL_KINDS.some((kind) => words.includes(kind))) {
        return {};
    }
    return { labels: { streets: words.includes('streets'), pois: words.includes('pois') } };
}

/** `near=`: one of `PHOTOS_NEAR_WINDOWS`; anything else is ignored. */
function decodePhotosNear(value: string): Partial<HashState> {
    const near = PHOTOS_NEAR_WINDOWS.find((window) => String(window) === value);
    return near === undefined ? {} : { photosNear: near };
}

type ParamDecoder = (value: string, limits: HashLimits) => Partial<Decoding>;

function decodeLang(value: string): Partial<HashState> {
    const lang = VIEWER_LOCALES.find((locale) => locale === value);
    return lang === undefined ? {} : { lang };
}

/** A Map, not an object literal: a key such as `constructor` or `__proto__` must find nothing. */
const PARAM_DECODERS: ReadonlyMap<string, ParamDecoder> = new Map<string, ParamDecoder>([
    ['layers', (value) => ({ layers: decodeIds(value) })],
    ['opacity', decodeOpacity],
    ['op', decodeOverlays],
    ['cmp', decodeCompareLayer],
    ['sw', decodeComparePosition],
    ['labels', decodeLabels],
    ['near', decodePhotosNear],
    ['photo', (value) => (isId(value) ? { photo: value } : {})],
    ['pv', (value) => ({ photoVersion: PHOTO_VIEWS.find((view) => view === value) ?? 'original' })],
    ['story', (value) => (isId(value) ? { story: value } : {})],
    ['lang', decodeLang],
]);

function decodeParam(segment: string, limits: HashLimits): Partial<Decoding> {
    const separator = segment.indexOf('=');
    const decoder = separator < 0 ? undefined : PARAM_DECODERS.get(segment.slice(0, separator));
    return decoder === undefined ? {} : decoder(segment.slice(separator + 1), limits);
}

/** The first segment: the map view, or already a parameter (`#photo=x`). */
function decodeHead(first: string, limits: HashLimits): Decoding {
    return first.includes('=') ? { legacy: false, ...decodeParam(first, limits) } : decodeView(first, limits);
}

/**
 * Reads a v1 or legacy hash (with or without its `#`). Never throws: whatever cannot be read is left
 * out of the result, and a repeated parameter keeps its last valid value.
 */
export function decodeHash(raw: string, limits: HashLimits = DEFAULT_HASH_LIMITS): DecodedHash {
    const text = raw.startsWith('#') ? raw.slice(1) : raw;
    if (text.length === 0 || text.length > MAX_HASH_LENGTH) {
        return { legacy: false };
    }
    // String.split always returns at least one element.
    const [first, ...rest] = text.split('&') as [string, ...string[]];
    return withCompare(
        rest.reduce<Decoding>((state, segment) => ({ ...state, ...decodeParam(segment, limits) }), decodeHead(first, limits)),
    );
}
