/**
 * Polling on the injected clock (`docs/research/M2b-interfaces.md` §3.6): a check every `intervalMs` while the tab is
 * visible, paused while it is hidden and run again as soon as it shows, given up `stopAfterMs` after the start (the card
 * then offers Check again). A failed check doubles the wait, up to `maxBackoff` times the interval, and the poll goes
 * on; a successful one resets it. Checks never overlap. The browser's timers back the clock, so Playwright's
 * `page.clock` drives every poll of the e2e tier.
 */
import type { SetupClock, VisibilityPort } from './ports.js';

/** What a check asks next: stop (found, or nothing more to wait for), the next check, or a longer wait (it failed). */
export type PollOutcome = 'stop' | 'next' | 'backoff';

export interface PollOptions {
    readonly intervalMs: number;
    readonly stopAfterMs: number;
    /** The longest wait, as a multiple of the interval (default 4). */
    readonly maxBackoff?: number;
}

export interface Poller {
    /** Starts polling (a running poller restarts its deadline); `immediate` checks at once, else after one interval. */
    start(immediate: boolean): void;
    stop(): void;
    isRunning(): boolean;
}

export interface PollDeps {
    readonly clock: SetupClock;
    readonly visibility: VisibilityPort;
}

class ClockPoller implements Poller {
    private running = false;
    private inFlight = false;
    private paused = false;
    private failures = 0;
    private deadline = 0;
    private timer: unknown = null;
    private unlisten: (() => void) | null = null;

    constructor(
        private readonly deps: PollDeps,
        private readonly options: PollOptions,
        private readonly check: () => Promise<PollOutcome>,
        private readonly onExpire: () => void,
    ) {}

    start(immediate: boolean): void {
        this.clearTimer();
        this.unlisten ??= this.deps.visibility.onChange(() => {
            this.onVisibility();
        });
        this.running = true;
        this.paused = false;
        this.failures = 0;
        this.deadline = this.deps.clock.now() + this.options.stopAfterMs;
        if (this.inFlight) {
            return;
        }
        if (immediate) {
            this.tick();
            return;
        }
        this.schedule();
    }

    stop(): void {
        this.clearTimer();
        this.unlisten?.();
        this.unlisten = null;
        this.running = false;
        this.paused = false;
    }

    isRunning(): boolean {
        return this.running;
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            this.deps.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private schedule(): void {
        const wait = this.options.intervalMs * Math.min(2 ** this.failures, this.options.maxBackoff ?? 4);
        this.timer = this.deps.clock.setTimeout(() => {
            this.timer = null;
            this.tick();
        }, wait);
    }

    private tick(): void {
        if (this.deps.clock.now() >= this.deadline) {
            this.stop();
            this.onExpire();
            return;
        }
        if (!this.deps.visibility.visible()) {
            this.paused = true;
            return;
        }
        this.inFlight = true;
        this.check().then(
            (outcome) => {
                this.settle(outcome);
            },
            () => {
                this.settle('backoff');
            },
        );
    }

    private settle(outcome: PollOutcome): void {
        this.inFlight = false;
        if (!this.running) {
            return;
        }
        if (outcome === 'stop') {
            this.stop();
            return;
        }
        this.failures = outcome === 'backoff' ? this.failures + 1 : 0;
        this.schedule();
    }

    private onVisibility(): void {
        if (this.paused && this.deps.visibility.visible()) {
            this.paused = false;
            this.tick();
        }
    }
}

/** `check` runs on every tick; `onExpire` once the deadline passes without a `stop`. */
export function createPoller(deps: PollDeps, options: PollOptions, check: () => Promise<PollOutcome>, onExpire: () => void): Poller {
    return new ClockPoller(deps, options, check, onExpire);
}
