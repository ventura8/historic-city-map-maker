/** Small helpers shared by the engine-core tests (memory storage, a recording logger, a fake telemetry, responses). */
import { createLogger, type Logger, type LogRecord } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import type { Unsubscribe } from '@hcm/ui/map';

import type { ConsentState, Measurement, TelemetryContext, TelemetryEvent, TelemetryPort } from '../../src/telemetry/telemetry-port.js';

export type MemoryStorage = Map<string, string> & Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A `localStorage` in memory; it is also the Map of what is stored. */
export function memoryStorage(entries: Readonly<Record<string, string>> = {}): MemoryStorage {
    const map = new Map<string, string>(Object.entries(entries));
    return Object.assign(map, {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
        removeItem: (key: string) => {
            map.delete(key);
        },
    });
}

/** A storage whose every access throws (private browsing, blocked site data). */
export const brokenStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: () => {
        throw new Error('SecurityError');
    },
    setItem: () => {
        throw new Error('QuotaExceededError');
    },
    removeItem: () => {
        throw new Error('SecurityError');
    },
};

export interface RecordingLog {
    readonly log: Logger;
    readonly records: readonly LogRecord[];
    messages(): string[];
}

export function recordingLog(): RecordingLog {
    const recording = createRecordingSink();
    return {
        log: createLogger('test', { sink: recording.sink, minLevel: 'debug' }),
        records: recording.records,
        messages: () => recording.records.map((record) => record.message),
    };
}

/** A `TelemetryPort` that records events, consent, contexts and field measurements. */
export class FakeTelemetry implements TelemetryPort {
    consent: ConsentState;
    readonly events: TelemetryEvent[] = [];
    readonly errors: unknown[] = [];
    readonly contexts: TelemetryContext[] = [];
    /** The field measurements reported (§76), in order. */
    readonly measures: Measurement[] = [];
    destroyed = false;
    readonly #listeners = new Set<(consent: ConsentState) => void>();

    constructor(consent: ConsentState = 'unknown') {
        this.consent = consent;
    }

    setConsent(consent: 'granted' | 'denied'): void {
        this.consent = consent;
        for (const listener of this.#listeners) {
            listener(consent);
        }
    }

    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    logEvent(event: TelemetryEvent): void {
        this.events.push(event);
    }

    reportError(error: unknown): void {
        this.errors.push(error);
    }

    setContext(context: TelemetryContext): void {
        this.contexts.push(context);
    }

    measure(measurement: Measurement): void {
        this.measures.push(measurement);
    }

    destroy(): void {
        this.destroyed = true;
    }

    get listenerCount(): number {
        return this.#listeners.size;
    }
}

/** A `Response` with a JSON body. */
export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Lets pending promise callbacks run (a few microtask turns: the boot waits for the manifest and the language's texts). */
export async function settle(turns = 20): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
        await Promise.resolve();
    }
}
