/**
 * Pause (the owner's request of 2026-11-13; `docs/research/M7-local-worker.md` → *Pause*): what the worker feed shows of a paused
 * job or computer, and how long a computer's pause lasts. Until I resume has no end; For 1 hour ends an hour from now; Until
 * tomorrow ends at 08:00 tomorrow on this computer's clock. The server (`imagery.pause`) checks the end is within two days.
 */
import { timestampToDate, type TimestampLike } from '@hcm/shared';

/** The three ways to pause a computer. */
export type PauseLength = 'forever' | 'hour' | 'tomorrow';

/** A pause as the panel and the job's card show it: who (an account, or `computer`), when, and until when (ISO). */
export interface PausedView {
    readonly by: string;
    readonly at: string;
    readonly until: string | null;
}

/** The hour Until tomorrow ends at, on this computer's clock. */
const MORNING_HOUR = 8;
const HOUR_MS = 3_600_000;

/** When a pause of `length` started at `now` ends (ISO), or undefined for Until I resume. */
export function pauseUntil(length: PauseLength, now: Date): string | undefined {
    if (length === 'hour') {
        return new Date(now.getTime() + HOUR_MS).toISOString();
    }
    if (length === 'tomorrow') {
        const morning = new Date(now);
        morning.setDate(morning.getDate() + 1);
        morning.setHours(MORNING_HOUR, 0, 0, 0);
        return morning.toISOString();
    }
    return undefined;
}

function isoOf(time: TimestampLike): string {
    return timestampToDate(time).toISOString();
}

/** A document's pause as shown, or null for none. */
export function pausedOf(
    paused: { readonly by: string; readonly at: TimestampLike; readonly until?: TimestampLike | undefined } | undefined,
): PausedView | null {
    if (paused === undefined) {
        return null;
    }
    return { by: paused.by, at: isoOf(paused.at), until: paused.until === undefined ? null : isoOf(paused.until) };
}
