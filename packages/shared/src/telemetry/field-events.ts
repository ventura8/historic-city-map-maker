/**
 * The GA4 events of the viewer and the admin, typed and checked before they are sent (`docs/ARCHITECTURE.md` → *Field
 * measurements*, `docs/research/DECISIONS-for-review.md` §76). Every event the two apps log goes through
 * {@link createFieldGuard} (over the app's own table: the viewer's guard knows no admin event, and the other way round) in
 * the consented lazy chunk, which drops it unless:
 *
 * - its name is one of the app's events (`viewer-events.ts`, `admin-events.ts`; GA4: at most 40 characters, a letter
 *   first, then letters, digits and `_`);
 * - it has at most 25 parameters and each string value at most 100 characters (`page_location` 1000), GA4's limits;
 * - no string value carries a URL query or fragment (`?`, `#`: the viewer's hash is the visitor's view), an e-mail
 *   address (`@`), a coordinate (a number with four decimals or more) or a tile path (`/z/x/y`): no position, no PII;
 * - its parameters match the event's strict zod schema (an unknown parameter is refused);
 * - the page's budget allows it ({@link FIELD_EVENT_BUDGET}): a broken page cannot flood GA4.
 */
import { z } from 'zod';

export type GaParamValue = string | number | boolean;
export type GaParams = Readonly<Record<string, GaParamValue>>;

/** GA4's limits (Google Analytics → *Event collection limits*). */
export const GA_LIMITS = { nameLength: 40, params: 25, valueLength: 100, pageLocationLength: 1000 } as const;

export const WEB_VITAL_NAMES = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const;
export const WINDOW_CLASS_NAMES = ['compact', 'medium', 'expanded', 'large', 'extra-large'] as const;
export const VIEWER_PHASES = ['manifest', 'map_render', 'map_idle'] as const;
export const MAP_ERROR_KINDS = ['style', 'source', 'tile', 'webgl', 'unknown'] as const;

export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];
export type ViewerPhase = (typeof VIEWER_PHASES)[number];

/** The field measurements (§76) of the viewer (`viewer-events.ts`) and of the admin (`admin-events.ts`). */
export type FieldEventName =
    | 'web_vitals'
    | 'viewer_timing'
    | 'manifest_error'
    | 'map_unavailable'
    | 'map_errors'
    | 'photo_timing'
    | 'compare_timing'
    | 'admin_ready'
    | 'setup_check'
    | 'install_build'
    | 'provision_item'
    | 'editor_save'
    | 'job_done'
    | 'admin_action'
    // The wizard funnels' events (`FUNNEL_EVENT_NAMES` of `funnel-hub.ts`, which imports this module: named here, no cycle).
    | 'wizard_start'
    | 'step_view'
    | 'step_complete'
    | 'step_back'
    | 'step_error'
    | 'step_help_opened'
    | 'step_action'
    | 'wizard_abandon'
    | 'wizard_complete'
    | 'ui_error';

/** A duration or time in whole milliseconds: at most a day (a page left open overnight). */
export const msSchema = z.number().int().min(0).max(86_400_000);
/** A short token: a step, a state, a key (letters, digits, `.`, `_`, `-`). */
export const tokenSchema = z.string().regex(/^[A-Za-z][\w.-]{0,99}$/);
export const countSchema = z.number().int().min(0).max(1_000_000);

/** What every field measurement carries: the app, the window class and the release (`app.window_class` in explorations). */
export const CONTEXT_PARAMS = {
    app: z.enum(['viewer', 'admin']),
    window_class: z.enum(WINDOW_CLASS_NAMES),
    release: z.string().regex(/^[\w.+-]{1,40}$/),
};

/**
 * The attribution's numbers web-vitals reports, by GA4 parameter: LCP's parts, INP's parts, CLS's largest shift, FCP after
 * the first byte, TTFB's parts (`web-vitals.ts` maps them; absent ones are left out).
 */
export const VITAL_DEBUG_NUMBERS = [
    ['debug_ttfb', 'timeToFirstByte'],
    ['debug_resource_delay', 'resourceLoadDelay'],
    ['debug_resource_duration', 'resourceLoadDuration'],
    ['debug_render_delay', 'elementRenderDelay'],
    ['debug_input_delay', 'inputDelay'],
    ['debug_processing', 'processingDuration'],
    ['debug_presentation', 'presentationDelay'],
    ['debug_shift_value', 'largestShiftValue'],
    ['debug_fcp_after_ttfb', 'firstByteToFCP'],
    ['debug_dns', 'dnsDuration'],
    ['debug_connection', 'connectionDuration'],
    ['debug_request', 'requestDuration'],
    ['debug_waiting', 'waitingDuration'],
    ['debug_cache', 'cacheDuration'],
] as const;

/** A short selector of the app's own elements (`hcm-photo-sheet>div>img`): tags and classes, never ids, text or URLs. */
const target = z.string().regex(/^[a-z0-9 >.*-]{1,100}$/);
const debugMs = z.number().min(0).max(86_400_000).optional();

/** The events both apps send: GA4's `exception` (crashes, after consent) and the Core Web Vitals. */
export const COMMON_EVENT_PARAMS = {
    exception: { description: z.string().min(1).max(100), fatal: z.boolean() },
    web_vitals: {
        metric_name: z.enum(WEB_VITAL_NAMES),
        metric_value: z.number().min(0).max(86_400_000),
        metric_delta: z.number().min(-86_400_000).max(86_400_000),
        metric_id: z.string().regex(/^[\w.-]{1,100}$/),
        // web-vitals' own words (`good`, `back-forward-cache`, `dom-interactive`, `pointer`, …) as short tokens.
        metric_rating: tokenSchema,
        navigation_type: tokenSchema,
        value: z.number().int().min(0).max(86_400_000),
        debug_target: target.optional(),
        debug_load_state: tokenSchema.optional(),
        debug_interaction_type: tokenSchema.optional(),
        ...Object.fromEntries(VITAL_DEBUG_NUMBERS.map(([name]) => [name, debugMs])),
        ...CONTEXT_PARAMS,
    },
    /**
     * An error the user was shown (the viewer's toast, the admin's notice or refusal): its catalogue key or code, and in
     * the admin the page's route; never its words (docs/ARCHITECTURE.md → *Wizard funnels*).
     */
    ui_error: { code: tokenSchema, route: tokenSchema.optional(), ...CONTEXT_PARAMS },
};

/** Each event's parameters besides `page_location` (an app's table: `viewer-events.ts`, `admin-events.ts`). */
export type EventShapes = Readonly<Record<string, z.ZodRawShape>>;

/** How many events of a name one page may send, and all together (a page left open for a day included). */
export const FIELD_EVENT_BUDGET = {
    total: 300,
    perName: 100,
    names: {
        web_vitals: 15,
        viewer_timing: 6,
        manifest_error: 5,
        map_unavailable: 5,
        map_errors: 30,
        compare_timing: 20,
        admin_ready: 2,
        install_build: 20,
        provision_item: 60,
        exception: 10,
        step_action: 60,
        ui_error: 30,
    } as Readonly<Partial<Record<string, number>>>,
} as const;

const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/;
/** A query, a fragment, an e-mail address, a coordinate (four decimals or more) or a tile path (`/z/x/y`). */
const UNSAFE_TEXT = /[?#@]|-?\d{1,3}\.\d{4,}|\/\d{1,2}\/\d+\/\d+/;

export type DropReason = 'name' | 'size' | 'privacy' | 'schema' | 'budget';

export type GuardResult =
    { readonly ok: true; readonly params: GaParams } | { readonly ok: false; readonly reason: DropReason; readonly first: boolean };

export interface FieldGuard {
    /** The event as it may be sent, or why it is dropped (`first`: the first drop of that reason on this page). */
    check(name: string, params: GaParams): GuardResult;
}

/** A string value that is too long or reveals a position, a URL's query or fragment, or an e-mail address. */
function unsafeValue([key, value]: readonly [string, GaParamValue]): boolean {
    if (typeof value !== 'string' || key === 'page_location') {
        return false;
    }
    return value.length > GA_LIMITS.valueLength || UNSAFE_TEXT.test(value);
}

const PAGE_LOCATION = z
    .string()
    .max(GA_LIMITS.pageLocationLength)
    .regex(/^https?:\/\/[^\s?#@]+$/);

/**
 * Which app sent an event, and in the admin with which role (`DECISIONS-for-review.md` §203): the viewer sends `viewer`,
 * the admin `admin_<role>` of the open city (`admin` before a role is known). Every event may carry it; the Statistics view
 * counts visitors and visits per value (the start page loads no analytics, so it has none).
 */
export const APP_SURFACES = ['viewer', 'admin', 'admin_owner', 'admin_editor', 'admin_moderator', 'admin_uploader'] as const;

export type AppSurface = (typeof APP_SURFACES)[number];

/** The parameters every event of either app may carry besides its own (`page_location` aside). */
export const SURFACE_PARAMS = { app_surface: z.enum(APP_SURFACES).optional() } as const;

/** An app's events as strict schemas, `page_location` and the common parameters added to each (an unknown one is refused). */
export function eventSchemas(shapes: EventShapes): ReadonlyMap<string, z.ZodType> {
    return new Map(
        Object.entries(shapes).map(([name, shape]) => [
            name,
            z.strictObject({ ...shape, ...SURFACE_PARAMS, page_location: PAGE_LOCATION }),
        ]),
    );
}

/** More parameters than GA4 takes, or a value that is too long or reveals a position, a URL's query or fragment, or PII. */
function paramsProblem(params: GaParams): 'size' | 'privacy' | null {
    const entries = Object.entries(params);
    if (entries.length > GA_LIMITS.params) {
        return 'size';
    }
    return entries.some(unsafeValue) ? 'privacy' : null;
}

/** Why `params` of `name` may not be sent as they are (the budget aside), or null. */
export function eventProblem(
    schemas: ReadonlyMap<string, z.ZodType>,
    name: string,
    params: GaParams,
): Exclude<DropReason, 'budget'> | null {
    const schema = EVENT_NAME.test(name) ? schemas.get(name) : undefined;
    if (schema === undefined) {
        return 'name';
    }
    return paramsProblem(params) ?? (schema.safeParse(params).success ? null : 'schema');
}

/** A page's budget: at most `total` events, and at most each name's own number (else `perName`). */
class Budget {
    readonly #sent = new Map<string, number>();
    #total = 0;

    admit(name: string): boolean {
        const sent = this.#sent.get(name) ?? 0;
        const limit = FIELD_EVENT_BUDGET.names[name] ?? FIELD_EVENT_BUDGET.perName;
        if (this.#total >= FIELD_EVENT_BUDGET.total || sent >= limit) {
            return false;
        }
        this.#total += 1;
        this.#sent.set(name, sent + 1);
        return true;
    }
}

/** One page's guard over an app's schemas (`eventSchemas`): every event checked, the page's budget counted. */
export function createFieldGuard(schemas: ReadonlyMap<string, z.ZodType>): FieldGuard {
    const budget = new Budget();
    const seen = new Set<DropReason>();
    const drop = (reason: DropReason): GuardResult => {
        const first = !seen.has(reason);
        seen.add(reason);
        return { ok: false, reason, first };
    };
    return {
        check: (name, params) => {
            const problem = eventProblem(schemas, name, params);
            if (problem !== null) {
                return drop(problem);
            }
            return budget.admit(name) ? { ok: true, params } : drop('budget');
        },
    };
}
