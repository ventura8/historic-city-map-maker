/**
 * The listening half of the wizard funnel (`wizard-funnel.ts`; `docs/ARCHITECTURE.md` → *Wizard funnels*): it turns the
 * pages' `hcm-funnel` signals into GA4 events with each step's attempt and time, and sends a `wizard_abandon` for every
 * wizard begun but not finished when the page is hidden or left (`pagehide`, `visibilitychange`).
 *
 * | Event | Parameters |
 * | --- | --- |
 * | `wizard_start` | `wizard_id` |
 * | `step_view` | `wizard_id`, `step_id`, `attempt` (the how-many-th time this step is shown on the page) |
 * | `step_complete` | `wizard_id`, `step_id`, `attempt`, `duration_ms` (since the step was last shown) |
 * | `step_back` | `wizard_id`, `step_id` (the step left), `attempt` |
 * | `step_error` | `wizard_id`, `step_id`, `error_code`, `attempt` |
 * | `step_help_opened` | `wizard_id`, `step_id` |
 * | `step_action` | `wizard_id`, `step_id`, `action` (`points_added` …) |
 * | `wizard_abandon` | `wizard_id`, `step_id` (the last step), `duration_ms` (since the start) |
 * | `wizard_complete` | `wizard_id`, `duration_ms` (since the start) |
 *
 * The app adds its context (`app`, `window_class`, `release`) and sends them only after consent. The hub batches: events
 * wait in memory and leave together after {@link FUNNEL_FLUSH_MS} or at once when the page is hidden, so a burst of
 * renders costs one hand-off. It never throws: a failing sender loses its events and logs once.
 */
import type { Logger } from '../log.js';
import type { GaParams } from './field-events.js';
import { FUNNEL_EVENT, type FunnelSignal, type WizardId } from './wizard-funnel.js';

export const FUNNEL_EVENT_NAMES = [
    'wizard_start',
    'step_view',
    'step_complete',
    'step_back',
    'step_error',
    'step_help_opened',
    'step_action',
    'wizard_abandon',
    'wizard_complete',
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

/** How long events wait to leave together. */
export const FUNNEL_FLUSH_MS = 2000;

/** A step or code the guard would refuse (not a short token) is sent as this. */
const UNKNOWN = 'unknown';
const TOKEN = /^[A-Za-z][\w.-]{0,99}$/;

function token(value: string): string {
    return TOKEN.test(value) ? value : UNKNOWN;
}

export interface FunnelHubDeps {
    /** Hands one event to the app's telemetry (consent-gated there). */
    readonly send: (name: FunnelEventName, params: GaParams) => void;
    /** Milliseconds (`performance.now()`). */
    readonly now: () => number;
    readonly log: Logger;
    readonly setTimer?: (run: () => void, ms: number) => unknown;
    readonly clearTimer?: (timer: unknown) => void;
}

/** A signal about one step (not a move between steps, not the end). */
type StepSignal = Exclude<FunnelSignal, { readonly kind: 'view' | 'finish' }>;
type StepEvent = readonly [FunnelEventName, GaParams];

/** One wizard on this page: when it began, its step, each step's attempts and when each was last shown. */
interface Run {
    readonly startedAt: number;
    step: string;
    readonly attempts: Map<string, number>;
    readonly shownAt: Map<string, number>;
    finished: boolean;
    abandoned: boolean;
}

/** The window the hub listens on: its signals and its hiding. */
export interface FunnelWindow {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
    readonly document: { readonly visibilityState: string };
}

export class FunnelHub {
    readonly #deps: FunnelHubDeps;
    readonly #runs = new Map<WizardId, Run>();
    #queue: (readonly [FunnelEventName, GaParams])[] = [];
    #timer: unknown = null;
    #failed = false;

    constructor(deps: FunnelHubDeps) {
        this.#deps = deps;
    }

    /** One signal of a page. Never throws. */
    handle(signal: FunnelSignal): void {
        try {
            this.#handle(signal);
        } catch (error) {
            this.#deps.log.warn('funnel signal dropped', { kind: signal.kind, error: String(error) });
        }
    }

    /** Every wizard begun and not finished: one `wizard_abandon` each, then everything leaves at once. */
    abandon(): void {
        for (const [wizard, run] of this.#runs) {
            if (!run.finished && !run.abandoned) {
                run.abandoned = true;
                this.#queueEvent('wizard_abandon', { wizard_id: wizard, step_id: run.step, duration_ms: this.#since(run.startedAt) });
            }
        }
        this.flush();
    }

    /** Hands the waiting events over now. */
    flush(): void {
        if (this.#timer !== null) {
            (this.#deps.clearTimer ?? clearTimeout)(this.#timer as ReturnType<typeof setTimeout>);
            this.#timer = null;
        }
        const queue = this.#queue;
        this.#queue = [];
        for (const [name, params] of queue) {
            this.#send(name, params);
        }
    }

    /** Listens for the pages' signals and the page's hiding on `win`; the result stops it. */
    listen(win: FunnelWindow): () => void {
        const signal = (event: Event): void => {
            this.handle((event as CustomEvent<FunnelSignal>).detail);
        };
        const hidden = (): void => {
            if (win.document.visibilityState === 'hidden') {
                this.abandon();
            }
        };
        const left = (): void => {
            this.abandon();
        };
        win.addEventListener(FUNNEL_EVENT, signal);
        win.addEventListener('visibilitychange', hidden);
        win.addEventListener('pagehide', left);
        return () => {
            win.removeEventListener(FUNNEL_EVENT, signal);
            win.removeEventListener('visibilitychange', hidden);
            win.removeEventListener('pagehide', left);
            this.flush();
        };
    }

    #handle(signal: FunnelSignal): void {
        if (signal.kind === 'view') {
            this.#view(signal.wizard, token(signal.step), signal.back);
            return;
        }
        if (signal.kind === 'finish') {
            this.#finish(signal.wizard);
            return;
        }
        this.#stepEvent(signal);
    }

    /** The run of `wizard`, begun now (`wizard_start`) when it has none or the last one finished. */
    #run(wizard: WizardId, step: string): Run {
        const current = this.#runs.get(wizard);
        if (current !== undefined && !current.finished) {
            current.abandoned = false;
            return current;
        }
        const run: Run = { startedAt: this.#deps.now(), step, attempts: new Map(), shownAt: new Map(), finished: false, abandoned: false };
        this.#runs.set(wizard, run);
        this.#queueEvent('wizard_start', { wizard_id: wizard });
        return run;
    }

    #view(wizard: WizardId, step: string, back: boolean): void {
        const run = this.#run(wizard, step);
        if (back) {
            this.#queueEvent('step_back', { wizard_id: wizard, step_id: run.step, attempt: run.attempts.get(run.step) ?? 1 });
        }
        const attempt = (run.attempts.get(step) ?? 0) + 1;
        run.attempts.set(step, attempt);
        run.shownAt.set(step, this.#deps.now());
        run.step = step;
        this.#queueEvent('step_view', { wizard_id: wizard, step_id: step, attempt });
    }

    #finish(wizard: WizardId): void {
        const run = this.#runs.get(wizard);
        if (run !== undefined && !run.finished) {
            run.finished = true;
            this.#queueEvent('wizard_complete', { wizard_id: wizard, duration_ms: this.#since(run.startedAt) });
        }
    }

    /** `step_complete`, `step_error`, `step_help_opened` or `step_action` of a step (the wizard begun if it was not). */
    #stepEvent(signal: StepSignal): void {
        const step = token(signal.step);
        const run = this.#run(signal.wizard, step);
        const base = { wizard_id: signal.wizard, step_id: step };
        const attempt = run.attempts.get(step) ?? 1;
        const events: { readonly [K in StepSignal['kind']]: (signal: Extract<StepSignal, { readonly kind: K }>) => StepEvent } = {
            complete: () => ['step_complete', { ...base, attempt, duration_ms: this.#since(run.shownAt.get(step) ?? run.startedAt) }],
            error: (error) => ['step_error', { ...base, error_code: token(error.code), attempt }],
            help: () => ['step_help_opened', base],
            action: (action) => ['step_action', { ...base, action: token(action.action) }],
        };
        const [name, params] = (events[signal.kind] as (signal: StepSignal) => StepEvent)(signal);
        this.#queueEvent(name, params);
    }

    #since(start: number): number {
        return Math.max(0, Math.round(this.#deps.now() - start));
    }

    #queueEvent(name: FunnelEventName, params: GaParams): void {
        this.#queue.push([name, params]);
        this.#timer ??= (this.#deps.setTimer ?? setTimeout)(() => {
            this.#timer = null;
            this.flush();
        }, FUNNEL_FLUSH_MS);
    }

    #send(name: FunnelEventName, params: GaParams): void {
        try {
            this.#deps.send(name, params);
        } catch (error) {
            if (!this.#failed) {
                this.#failed = true;
                this.#deps.log.warn('funnel event not sent', { name, error: String(error) });
            }
        }
    }
}
