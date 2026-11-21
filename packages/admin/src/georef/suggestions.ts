/**
 * The georeferencer's suggestions (`docs/research/M4-interfaces.md` §2.5; behaviour A44): the pairs the automatic
 * matching was less sure of (`layerVersion.suggestions`, best first), each labelled `a1`, `a2`, … in that order on both
 * panes and in the list. Accept moves one into the pairs (`acceptSuggestions` of `@hcm/shared`: enabled, origin `auto`,
 * a free id, the same scan pixel never twice), Accept all moves every one still pending, Reject hides one for the page
 * visit; a suggestion already among the pairs is not pending. Each pending one says how far the page's current fit puts
 * it (`offsetM`, computed again on every change of the pairs: the matcher's own `residualM` was against its fit of the
 * moment, and a version waiting for points had none). Nothing here writes: the accepted pairs are the page's unsaved
 * pairs until Save (`imagery.saveGcps`). Pure: the store keeps the rejected ids and the selection.
 *
 * The city guard (`docs/LESSONS.md`, the 1974 archive maps): suggestions whose places, taken together, would put the map
 * outside the city (`landsInCity` of `@hcm/shared`) are each `doubtful`, never `high`, whatever their score; the panel says
 * the map would land outside the city, and Accept all accepts none of them (one may still be accepted on its own).
 */
import {
    acceptSuggestions,
    AUTO_GCP_MIN_CONFIDENCE,
    AUTO_GCP_SUGGEST_MIN,
    bboxOf,
    distanceFromFit,
    landsInCity,
    pendingSuggestions,
    type BBox,
    type FittedTransform,
    type Gcp,
    type LayerVersionDoc,
} from '@hcm/shared';

/**
 * How sure the matching was, in words: from `AUTO_GCP_MIN_CONFIDENCE` high, from halfway down to the floor medium;
 * `doubtful` whatever the score when the suggestions would put the map outside the city.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'doubtful';

const MEDIUM_FROM = (AUTO_GCP_SUGGEST_MIN + AUTO_GCP_MIN_CONFIDENCE) / 2;

export function confidenceLevel(score: number): ConfidenceLevel {
    if (score >= AUTO_GCP_MIN_CONFIDENCE) {
        return 'high';
    }
    return score >= MEDIUM_FROM ? 'medium' : 'low';
}

/** One suggestion as the panel and the panes show it. */
export interface SuggestionRow {
    /** `a1`, `a2`, … by its place in the version's list (it keeps its label while others are decided). */
    readonly label: string;
    readonly pair: Gcp;
    readonly level: ConfidenceLevel;
    /** Ground metres between its place and where the page's current fit puts its pixel; null without a fit. */
    readonly offsetM: number | null;
}

/** What the version holds: its suggestions and, when it waits for points, how many confident pairs the matching found. */
export interface VersionSuggestions {
    /** The matcher ran on the version (it has a suggestions record) or it waits for points after matching too few. */
    readonly matched: boolean;
    readonly all: readonly Gcp[];
    /** `noMatch {pairs}` (or `noSpread {pairs}`) of a version that waits for points, else null. */
    readonly confident: string | null;
    /** The version waits because its confident pairs lie almost in a line (`noSpread`), not because they are too few. */
    readonly noSpread: boolean;
}

const NO_VERSION_SUGGESTIONS: VersionSuggestions = { matched: false, all: [], confident: null, noSpread: false };

/** Why a version the matcher ran on waits for points: too few confident pairs, or enough that lie almost in a line. */
const WAITING_CODES: readonly string[] = ['apiError.imagery.noMatch', 'apiError.imagery.noSpread'];

/**
 * The version waits for points after the matching (`noMatch`, `noSpread`): a USGS import, the only kind the matcher runs
 * on (an upload without a georeference waits with `noMatch {pairs: 0}` too, though nothing was matched).
 */
function waitsAfterMatching(doc: LayerVersionDoc): boolean {
    return doc.origin === 'usgs' && doc.state === 'needs_gcps' && WAITING_CODES.includes(doc.error?.code ?? '');
}

/** The confident pairs' count a version waiting for points was left with (null otherwise). */
function confidentOf(doc: LayerVersionDoc): string | null {
    return waitsAfterMatching(doc) ? (doc.error?.params?.['pairs'] ?? '0') : null;
}

/** A version waiting for points says its confident pairs lie almost in a line. */
function waitsForSpread(doc: LayerVersionDoc): boolean {
    return waitsAfterMatching(doc) && doc.error?.code === 'apiError.imagery.noSpread';
}

export function versionSuggestions(doc: LayerVersionDoc): VersionSuggestions {
    const confident = confidentOf(doc);
    const all = doc.suggestions?.pairs ?? [];
    return { matched: doc.suggestions !== undefined || confident !== null, all, confident, noSpread: waitsForSpread(doc) };
}

/** The panel's view: the pending suggestions, the selected one, and what the version says about its matching. */
export interface SuggestionsView {
    readonly matched: boolean;
    readonly total: number;
    readonly pending: readonly SuggestionRow[];
    readonly selected: string | null;
    readonly confident: string | null;
    readonly noSpread: boolean;
    /** The suggestions' places would put the map outside the city: every row is doubtful and Accept all takes none. */
    readonly outsideCity: boolean;
}

export const NO_SUGGESTIONS: SuggestionsView = {
    ...{ matched: false, total: 0, pending: [], selected: null },
    ...{ confident: null, noSpread: false, outsideCity: false },
};

/** True when the suggestions' places, taken together, would put the map outside `city` (false without a city or a suggestion). */
function outsideCity(suggestions: readonly Gcp[], city: BBox | null): boolean {
    const footprint = bboxOf(suggestions.map((pair) => [pair.geo.lng, pair.geo.lat] as const));
    return city !== null && footprint !== null && !landsInCity(footprint, city);
}

/** Suggestion `pair`, the `index`th of the version's list, as a row: its label, its confidence, its distance from `fit`. */
function rowOf(pair: Gcp, index: number, fit: FittedTransform | null, doubtful: boolean): SuggestionRow {
    const offsetM = fit === null ? null : distanceFromFit(fit, pair);
    const level = doubtful ? 'doubtful' : confidenceLevel(pair.score ?? 0);
    return { label: `a${String(index + 1)}`, pair, level, offsetM };
}

/** The page's state a view is made for: its pairs, its current fit or null when none is possible yet, the rejected ids. */
export interface SuggestionsPage {
    readonly pairs: readonly Gcp[];
    readonly fit: FittedTransform | null;
    readonly rejected: ReadonlySet<string>;
    readonly selected: string | null;
    /** The city's bounds (null until the city was read): the guard's reference. */
    readonly city?: BBox | null;
}

/** The rows still to decide, each with its label and its distance from the current fit. */
export function suggestionsView(source: VersionSuggestions, page: SuggestionsPage): SuggestionsView {
    const { pairs, fit, rejected, selected } = page;
    const outside = outsideCity(source.all, page.city ?? null);
    // An accepted suggestion moved since (a manual pair now) keeps its id: it is decided, not pending again.
    const placed = new Set(pairs.map((pair) => pair.id));
    const open = new Set(pendingSuggestions(source.all, pairs, rejected).map((pair) => pair.id));
    const pending = source.all.flatMap((pair, index) =>
        open.has(pair.id) && !placed.has(pair.id) ? [rowOf(pair, index, fit, outside)] : [],
    );
    const kept = pending.some((row) => row.pair.id === selected) ? selected : null;
    const { matched, confident, noSpread } = source;
    return { matched, total: source.all.length, pending, selected: kept, confident, noSpread, outsideCity: outside };
}

/**
 * The store's side of the suggestions for one page visit: the version's list, the ids rejected on this page and the
 * selected suggestion (the panes follow it). Accepting returns the pairs to refit; the store keeps them.
 */
export class Suggestions {
    #source: VersionSuggestions = NO_VERSION_SUGGESTIONS;
    #rejected = new Set<string>();
    #selected: string | null = null;
    #city: BBox | null = null;

    /** The city's bounds, for the guard (kept across versions: the page shows one city). */
    setCity(city: BBox): void {
        this.#city = city;
    }

    /** A new snapshot of the version (the rejected ones stay rejected). */
    load(doc: LayerVersionDoc): void {
        this.#source = versionSuggestions(doc);
    }

    /** The page closed: nothing is rejected or selected any more. */
    reset(): void {
        this.#source = NO_VERSION_SUGGESTIONS;
        this.#rejected = new Set();
        this.#selected = null;
    }

    /** The panel's view for the page's pairs and its current fit. */
    view(pairs: readonly Gcp[], fit: FittedTransform | null): SuggestionsView {
        return suggestionsView(this.#source, { pairs, fit, rejected: this.#rejected, selected: this.#selected, city: this.#city });
    }

    /** The pairs with suggestion `id` accepted (or every pending one, without an id; none when they would land outside the city). */
    accepted(pairs: readonly Gcp[], id?: string): readonly Gcp[] {
        const view = this.view(pairs, null);
        if (id === undefined && view.outsideCity) {
            return pairs;
        }
        const pending = view.pending.map((row) => row.pair);
        return acceptSuggestions(pairs, pending, id === undefined ? undefined : [id]);
    }

    reject(id: string): void {
        this.#rejected.add(id);
    }

    select(id: string | null): void {
        this.#selected = id;
    }
}
