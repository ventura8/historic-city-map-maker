/**
 * The USGS token countdown (`docs/research/M2b-interfaces.md` §3.3 f): ERS shows a new application token for about 60
 * seconds, so the card counts down while the owner copies it. The seconds left come from the clock's time, not from
 * counting ticks, so a throttled background tab still ends on time.
 */
import type { SetupClock } from './ports.js';

export const USGS_TOKEN_SECONDS = 60;

export interface Countdown {
    /** Starts (or restarts) from `seconds`; `onTick` gets the seconds left now and every second. */
    start(): void;
    stop(): void;
}

class ClockCountdown implements Countdown {
    private deadline = 0;
    private timer: unknown = null;

    constructor(
        private readonly clock: SetupClock,
        private readonly seconds: number,
        private readonly onTick: (secondsLeft: number) => void,
        private readonly onEnd: () => void,
    ) {}

    start(): void {
        this.stop();
        this.deadline = this.clock.now() + this.seconds * 1000;
        this.onTick(this.seconds);
        this.schedule();
    }

    stop(): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private schedule(): void {
        this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            this.tick();
        }, 1000);
    }

    private tick(): void {
        const left = Math.ceil((this.deadline - this.clock.now()) / 1000);
        if (left <= 0) {
            this.onEnd();
            return;
        }
        this.onTick(left);
        this.schedule();
    }
}

export function createCountdown(clock: SetupClock, seconds: number, onTick: (secondsLeft: number) => void, onEnd: () => void): Countdown {
    return new ClockCountdown(clock, seconds, onTick, onEnd);
}
