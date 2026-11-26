/**
 * Core Web Vitals as GA4 `web_vitals` parameters (`docs/ARCHITECTURE.md` → *Field measurements*): what Google's
 * `web-vitals` package (its attribution build, imported only by the apps' consented lazy chunks) reports, mapped to
 * numbers and short tokens. Environment-neutral: the chunk passes `onLCP`, `onINP`, `onCLS`, `onFCP` and `onTTFB` in.
 *
 * Never sent: the LCP resource's URL, the navigation's URL (soft navigations carry the hash), script sources, text.
 * The element a metric names is reduced by {@link shortTarget} to a selector of the app's own elements.
 */
import { VITAL_DEBUG_NUMBERS, type FieldGuard, type GaParams, type WebVitalName } from './field-events.js';

/**
 * What an app's consented lazy chunk provides (`field-sdk.ts` of the engine and of the admin, the only modules that
 * import `web-vitals`): one page's event guard and the Core Web Vitals observers.
 */
export interface FieldChunk {
    readonly createGuard: () => FieldGuard;
    readonly observeVitals: (report: (params: GaParams) => void) => void;
}

/** What the mapping reads of a web-vitals attribution (every build's fields are optional here). */
export interface VitalAttribution {
    readonly target?: string | undefined;
    readonly interactionTarget?: string | undefined;
    readonly largestShiftTarget?: string | undefined;
    readonly loadState?: string | undefined;
    readonly interactionType?: string | undefined;
    readonly timeToFirstByte?: number | undefined;
    readonly resourceLoadDelay?: number | undefined;
    readonly resourceLoadDuration?: number | undefined;
    readonly elementRenderDelay?: number | undefined;
    readonly inputDelay?: number | undefined;
    readonly processingDuration?: number | undefined;
    readonly presentationDelay?: number | undefined;
    readonly largestShiftValue?: number | undefined;
    readonly firstByteToFCP?: number | undefined;
    readonly dnsDuration?: number | undefined;
    readonly connectionDuration?: number | undefined;
    readonly requestDuration?: number | undefined;
    readonly waitingDuration?: number | undefined;
    readonly cacheDuration?: number | undefined;
}

/** A web-vitals metric with attribution, as far as the mapping reads it. */
export interface VitalMetric {
    readonly name: WebVitalName;
    readonly value: number;
    readonly delta: number;
    readonly id: string;
    readonly rating: string;
    readonly navigationType: string;
    readonly attribution: VitalAttribution;
}

/** The options every observer gets: final values only, and the app's own short selector. */
export interface VitalOptions {
    readonly generateTarget: (node: unknown) => string | undefined;
}

/** `onLCP`, `onINP`, … of `web-vitals/attribution`. */
export type VitalObserver = (report: (metric: VitalMetric) => void, options: VitalOptions) => void;

/** CLS is unitless (four decimals kept); the others are milliseconds (whole). */
function rounded(name: WebVitalName, value: number): number {
    return name === 'CLS' ? Math.round(value * 10_000) / 10_000 : Math.round(value);
}

/** A non-negative finite number, rounded to two decimals; else undefined. */
function measured(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

/** The selector web-vitals names (attribution `target`, `interactionTarget` or `largestShiftTarget`), if any. */
function targetOf(attribution: VitalAttribution): string | undefined {
    return attribution.target ?? attribution.interactionTarget ?? attribution.largestShiftTarget;
}

function textParams(attribution: VitalAttribution): GaParams {
    const target = sanitizeTarget(targetOf(attribution));
    return Object.fromEntries(
        [
            ['debug_target', target],
            ['debug_load_state', attribution.loadState],
            ['debug_interaction_type', attribution.interactionType],
        ].filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
}

function numberParams(attribution: VitalAttribution): GaParams {
    const entries: (readonly [string, number | undefined])[] = VITAL_DEBUG_NUMBERS.map(([param, field]) => [
        param,
        measured(attribution[field]),
    ]);
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry[1] !== undefined));
}

/**
 * A metric as `web_vitals` parameters: GA4's `value` is the delta (CLS × 1000), so a sum over events is the page's
 * total, as Google's own guide sends it; `metric_value` is the metric itself.
 */
export function vitalParams(metric: VitalMetric): GaParams {
    const scale = metric.name === 'CLS' ? 1000 : 1;
    return {
        metric_name: metric.name,
        metric_value: rounded(metric.name, metric.value),
        metric_delta: rounded(metric.name, metric.delta),
        metric_id: metric.id,
        metric_rating: metric.rating,
        navigation_type: metric.navigationType,
        value: Math.max(0, Math.round(metric.delta * scale)),
        ...textParams(metric.attribution),
        ...numberParams(metric.attribution),
    };
}

/** What {@link shortTarget} reads of a DOM node (plain objects in the tests). */
interface TargetNode {
    readonly nodeName: string;
    readonly parentNode?: TargetNode | null;
    /** A shadow root's host. */
    readonly host?: TargetNode | null;
    readonly classList?: ArrayLike<string>;
}

const TAG = /^[a-z][a-z0-9-]{0,40}$/;
const CLASS = /^[a-z][a-z0-9-]{0,24}$/;
/** The innermost segments kept: with the app's element in front, a selector stays short. */
const MAX_SEGMENTS = 3;

function isTargetNode(node: unknown): node is TargetNode {
    return typeof node === 'object' && node !== null && typeof (node as { nodeName?: unknown }).nodeName === 'string';
}

/** `tag` or `tag.class` (the first class only, and only one of the app's own forms). */
function segmentOf(node: TargetNode): string {
    const tag = node.nodeName.toLowerCase();
    const first = node.classList?.[0];
    const name = TAG.test(tag) ? tag : '*';
    return first !== undefined && CLASS.test(first) ? `${name}.${first}` : name;
}

/** The next element up: the parent, or the host across a shadow root; null at the document. */
function parentOf(node: TargetNode): TargetNode | null {
    const parent = node.parentNode ?? null;
    return parent?.nodeName.startsWith('#') === true ? (parent.host ?? null) : parent;
}

/** A segment's tag, without its class. */
function tagOf(segment: string): string {
    const dot = segment.indexOf('.');
    return dot < 0 ? segment : segment.slice(0, dot);
}

/** The innermost segments and the nearest `hcm-` element above them (its tag), walking at most 40 elements up. */
function walk(start: TargetNode): { readonly inner: readonly string[]; readonly app: string | null } {
    const inner: string[] = [];
    let node: TargetNode | null = start;
    for (let hops = 0; node !== null && hops < 40; hops += 1) {
        const segment = segmentOf(node);
        if (segment.startsWith('hcm-')) {
            return { inner, app: tagOf(segment) };
        }
        if (inner.length < MAX_SEGMENTS) {
            inner.unshift(segment);
        }
        node = parentOf(node);
    }
    return { inner, app: null };
}

/**
 * A short selector of the node within the app's own elements: the nearest `hcm-` element, then at most three inner
 * segments (`hcm-photo-sheet div.details>button.image>img`). A node outside every `hcm-` element (the embedding page's)
 * is `page`; nothing is a node's id, text or attribute.
 */
export function shortTarget(node: unknown): string | undefined {
    if (!isTargetNode(node)) {
        return undefined;
    }
    const { inner, app } = walk(node);
    if (app === null) {
        return 'page';
    }
    return sanitizeTarget(inner.length === 0 ? app : `${app} ${inner.join('>')}`);
}

/** A selector cut to GA4's 100 characters, keeping only the characters of {@link shortTarget}'s form. */
export function sanitizeTarget(selector: string | undefined): string | undefined {
    if (selector === undefined || !/^[a-z0-9 >.*-]+$/.test(selector)) {
        return undefined;
    }
    return selector.slice(0, 100);
}

/** Registers every observer with the app's selector, reporting each metric as `web_vitals` parameters. */
export function observeWebVitals(observers: readonly VitalObserver[], report: (params: GaParams) => void): void {
    for (const observe of observers) {
        observe(
            (metric) => {
                report(vitalParams(metric));
            },
            { generateTarget: shortTarget },
        );
    }
}
