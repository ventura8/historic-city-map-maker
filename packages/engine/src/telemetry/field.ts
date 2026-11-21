/**
 * The viewer's field measurements (docs/ARCHITECTURE.md → *Field measurements*, docs/research/DECISIONS-for-review.md
 * §76): the boot's phases from the engine's start (`viewer_timing`: the manifest loaded, the map's first render, the
 * map's first idle), a failed manifest (`manifest_error`), no map (`map_unavailable`), the map's errors counted by kind
 * (`map_errors`: the first of a kind at once, then the count since, at most once per {@link MAP_ERROR_INTERVAL_MS} and
 * when the page is hidden), and the time from a photo's click to its decoded thumbnail (`photo_timing`) and from Compare
 * to its second map (`compare_timing`).
 *
 * Times come from `performance` (milliseconds since the navigation started), marked `hcm:<phase>` and measured from
 * `hcm:boot` for the browser's own tools. The recorder only builds events: telemetry's analytics sends them after
 * consent (`analytics.ts`, which also checks each against the guard of `@hcm/shared`), never before.
 */
import type { FieldEvent, Measurement } from './telemetry-port.js';

/** What the recorder needs of `performance`. */
export type FieldClock = Pick<Performance, 'now' | 'mark' | 'measure'>;

/** One `map_errors` event per kind at most this often (with the count since the last one), and one at page hide. */
export const MAP_ERROR_INTERVAL_MS = 30_000;

type Wait = Extract<Measurement, { readonly kind: 'start' | 'end' }>;

export class FieldRecorder {
    readonly #clock: FieldClock;
    readonly #send: (event: FieldEvent) => void;
    readonly #start: number;
    readonly #phases = new Set<string>();
    /** Map errors not sent yet, and when each kind was last sent. */
    readonly #errors = new Map<string, number>();
    readonly #errorsSent = new Map<string, number>();
    /** When the visitor's current waits (a photo, compare) began. */
    readonly #waits = new Map<string, number>();

    constructor(clock: FieldClock, send: (event: FieldEvent) => void) {
        this.#clock = clock;
        this.#send = send;
        this.#start = clock.now();
        this.#mark('boot');
    }

    record(measurement: Measurement): void {
        if (measurement.kind === 'phase') {
            this.#phase(measurement.phase);
        } else if (measurement.kind === 'map_error') {
            this.#mapError(measurement.errorKind);
        } else if (measurement.kind === 'start' || measurement.kind === 'end') {
            this.#wait(measurement);
        } else {
            const { kind, ...params } = measurement;
            this.#send({ name: kind, params });
        }
    }

    /** The map errors counted since each kind was last sent (the page is being hidden or left). */
    flush(): void {
        for (const kind of this.#errors.keys()) {
            this.#sendErrors(kind);
        }
    }

    #since(start: number): number {
        return Math.round(this.#clock.now() - start);
    }

    /** A phase is measured once per page, a Retry's included (its first time counts). */
    #phase(phase: string): void {
        if (this.#phases.has(phase)) {
            return;
        }
        this.#phases.add(phase);
        this.#mark(phase);
        this.#send({ name: 'viewer_timing', params: { phase, duration_ms: this.#since(this.#start), since_start_ms: this.#since(0) } });
    }

    /** A wait begins, or ends with its outcome (nothing for an end without a beginning). */
    #wait(wait: Wait): void {
        const begun = this.#waits.get(wait.what);
        this.#waits.delete(wait.what);
        if (wait.kind === 'start') {
            this.#waits.set(wait.what, this.#clock.now());
        } else if (begun !== undefined) {
            this.#send({ name: `${wait.what}_timing`, params: { duration_ms: this.#since(begun), outcome: wait.ok ? 'ok' : 'failed' } });
        }
    }

    #mapError(kind: string): void {
        this.#errors.set(kind, (this.#errors.get(kind) ?? 0) + 1);
        const last = this.#errorsSent.get(kind);
        if (last === undefined || this.#clock.now() - last >= MAP_ERROR_INTERVAL_MS) {
            this.#sendErrors(kind);
        }
    }

    #sendErrors(kind: string): void {
        const count = this.#errors.get(kind) ?? 0;
        if (count > 0) {
            this.#send({ name: 'map_errors', params: { error_kind: kind, error_count: count } });
            this.#errors.set(kind, 0);
            this.#errorsSent.set(kind, this.#clock.now());
        }
    }

    /** `hcm:<name>` in the browser's performance timeline, measured from `hcm:boot` (a missing API changes nothing). */
    #mark(name: string): void {
        try {
            this.#clock.mark(`hcm:${name}`);
            if (name !== 'boot') {
                this.#clock.measure(`hcm:${name}`, 'hcm:boot');
            }
        } catch {
            // A page that cleared the marks, or a browser without User Timing: the numbers are still measured.
        }
    }
}
