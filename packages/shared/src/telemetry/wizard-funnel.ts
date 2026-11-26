/**
 * One funnel for every wizard and multi-step flow (the owner's request of 2026-11-13, beta.1: "analytics through the app
 * and especially in the wizards, so we can see user pain points"; `docs/ARCHITECTURE.md` → *Wizard funnels*,
 * `docs/research/DECISIONS-for-review.md` §200).
 *
 * A page says where its wizard stands as a {@link FunnelSnapshot} each time it renders; {@link trackFunnel} compares it
 * with the page's previous one and dispatches what changed as `hcm-funnel` DOM events (bubbling and composed, so they
 * leave every shadow root). The app that sends analytics listens with a `FunnelHub` (`funnel-hub.ts`), which counts the
 * attempts and the time and hands GA4 events to its consent-gated telemetry. The UI kit therefore needs no telemetry
 * port: a page without a listening hub (a test, the start page) sends nothing.
 *
 * Ids and codes only, never words: a step is a short token (`billing`, `area`), an error is its catalogue key or the
 * refusal's code (`apiError.imagery.notReady`), never its text, a file name, an e-mail address or a coordinate. The plain
 * words go to the user; the codes go to analytics (the owner's rule).
 */

/** The DOM event's name (a `CustomEvent<FunnelSignal>`). */
export const FUNNEL_EVENT = 'hcm-funnel';

/** Every wizard and multi-step flow that reports a funnel (GA4's `wizard_id`). */
export const WIZARD_IDS = [
    /** The Setup Assistant: one step per card (Google Cloud, billing, Mapbox, USGS, the installs, Update the map …). */
    'setup',
    /** New city (`#/cities/new`): names, the area, Create. */
    'new_city',
    /** The start page (M14): intro, plan, work, provider, done. */
    'start',
    /** The tile-import wizard (`#/help/<version>/tiles`): its own steps. */
    'tiles',
    /** The georeferencer and Help-calibrate: points, save, approval. */
    'georef',
    /** A USGS import from Imagery → Find: search, import. */
    'usgs_import',
    /** An uploaded image (Imagery → Upload, a web or local file): choose, upload, check. */
    'upload',
    /** A local archive imported on the owner's computer: choose, upload, scan. */
    'local_import',
    /** "Run on my computer": choose, connect, up to date. */
    'worker',
] as const;

export type WizardId = (typeof WIZARD_IDS)[number];

/** Where a wizard stands, as its page renders it. */
export interface FunnelSnapshot {
    readonly wizard: WizardId;
    /** The steps in their order (a lower index is "back"). */
    readonly order: readonly string[];
    /** The step on screen, or null (nothing to show yet). */
    readonly step: string | null;
    /** The steps done. */
    readonly done: readonly string[];
    /** The error code each failing step shows (its catalogue key or the refusal's code). */
    readonly errors: Readonly<Record<string, string>>;
    /** The wizard reached its end. */
    readonly complete: boolean;
    /** Counted things the user adds or removes on the step on screen (the georeferencer's `points`). */
    readonly counts?: Readonly<Record<string, number>>;
}

/** One change of a wizard, as the hub receives it. */
export type FunnelSignal =
    | { readonly kind: 'view'; readonly wizard: WizardId; readonly step: string; readonly back: boolean }
    | { readonly kind: 'complete'; readonly wizard: WizardId; readonly step: string }
    | { readonly kind: 'error'; readonly wizard: WizardId; readonly step: string; readonly code: string }
    | { readonly kind: 'help'; readonly wizard: WizardId; readonly step: string }
    | { readonly kind: 'action'; readonly wizard: WizardId; readonly step: string; readonly action: string }
    | { readonly kind: 'finish'; readonly wizard: WizardId };

/** The step's place in the order, -1 when it is not in it. */
function indexOf(snapshot: FunnelSnapshot, step: string | null): number {
    return step === null ? -1 : snapshot.order.indexOf(step);
}

/** A move to another step; `back` when it lies before the one left. */
function viewSignals(previous: FunnelSnapshot | null, next: FunnelSnapshot): FunnelSignal[] {
    const step = next.step;
    if (step === null || step === previous?.step) {
        return [];
    }
    const back = previous !== null && indexOf(next, step) < indexOf(next, previous.step);
    return [{ kind: 'view', wizard: next.wizard, step, back }];
}

/** The steps done since the previous snapshot (none on the first: what was done before this page is not a completion). */
function completeSignals(previous: FunnelSnapshot | null, next: FunnelSnapshot): FunnelSignal[] {
    if (previous === null) {
        return [];
    }
    return next.done.filter((step) => !previous.done.includes(step)).map((step) => ({ kind: 'complete', wizard: next.wizard, step }));
}

/** Each error newly shown, or shown with another code (one already on screen when the page opens counts: the user sees it). */
function errorSignals(previous: FunnelSnapshot | null, next: FunnelSnapshot): FunnelSignal[] {
    return Object.entries(next.errors)
        .filter(([step, code]) => previous?.errors[step] !== code)
        .map(([step, code]) => ({ kind: 'error', wizard: next.wizard, step, code }));
}

/** A count that went up (`<name>_added`) or down (`<name>_removed`) on the step on screen. */
function actionSignals(previous: FunnelSnapshot | null, next: FunnelSnapshot): FunnelSignal[] {
    const step = next.step;
    if (previous === null || step === null) {
        return [];
    }
    return Object.entries(next.counts ?? {})
        .map(([name, count]) => [name, count - (previous.counts?.[name] ?? count)] as const)
        .filter(([, change]) => change !== 0)
        .map(([name, change]) => ({ kind: 'action', wizard: next.wizard, step, action: `${name}_${change > 0 ? 'added' : 'removed'}` }));
}

/** The end, once: the wizard just became complete. */
function finishSignals(previous: FunnelSnapshot | null, next: FunnelSnapshot): FunnelSignal[] {
    return next.complete && previous?.complete === false ? [{ kind: 'finish', wizard: next.wizard }] : [];
}

/**
 * What changed between two snapshots of one wizard, in the order the hub should hear it: the step left and the one shown,
 * the steps done, the errors, the counted actions, then the end. A wizard already complete when its page opens says nothing.
 */
export function funnelSignals(previous: FunnelSnapshot | null, next: FunnelSnapshot): readonly FunnelSignal[] {
    if (previous === null && next.complete) {
        return [];
    }
    return [
        ...completeSignals(previous, next),
        ...viewSignals(previous, next),
        ...errorSignals(previous, next),
        ...actionSignals(previous, next),
        ...finishSignals(previous, next),
    ];
}

/** Dispatches one signal from `target` (bubbling, composed). Never throws: analytics never breaks a page. */
export function signalFunnel(target: EventTarget, signal: FunnelSignal): void {
    try {
        target.dispatchEvent(new CustomEvent<FunnelSignal>(FUNNEL_EVENT, { detail: signal, bubbles: true, composed: true }));
    } catch {
        // A target that cannot dispatch (a detached test double) only loses the signal.
    }
}

/** The help of a step was opened (a guide, a "How?" link): one `step_help_opened`. */
export function funnelHelpOpened(target: EventTarget, wizard: WizardId, step: string): void {
    signalFunnel(target, { kind: 'help', wizard, step });
}

/** Each page's last snapshot per wizard. */
const LAST = new WeakMap<EventTarget, Map<WizardId, FunnelSnapshot>>();

/**
 * Compares `snapshot` with the last one `target` reported for the same wizard and dispatches what changed; null reports
 * nothing (the page has nothing to show yet). Call it on every render: an unchanged snapshot dispatches nothing.
 */
export function trackFunnel(target: EventTarget, snapshot: FunnelSnapshot | null): void {
    if (snapshot === null) {
        return;
    }
    const seen = LAST.get(target) ?? new Map<WizardId, FunnelSnapshot>();
    LAST.set(target, seen);
    const previous = seen.get(snapshot.wizard) ?? null;
    seen.set(snapshot.wizard, snapshot);
    for (const signal of funnelSignals(previous, snapshot)) {
        signalFunnel(target, signal);
    }
}

/**
 * The first step of `order` not in `done`: where a form-like wizard stands (New city, an upload); the last step once all
 * are done.
 */
export function firstOpenStep(order: readonly string[], done: readonly string[]): string | null {
    return order.find((step) => !done.includes(step)) ?? order.at(-1) ?? null;
}
