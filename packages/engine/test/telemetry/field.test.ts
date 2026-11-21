import { describe, expect, it } from 'vitest';

import { FieldRecorder, MAP_ERROR_INTERVAL_MS, type FieldClock } from '../../src/telemetry/field.js';
import type { FieldEvent } from '../../src/telemetry/telemetry-port.js';

/** A `performance` whose time the test sets; it records marks and measures. */
function fakeClock(start = 1000): FieldClock & { time: number; readonly marks: string[] } {
    const clock = {
        time: start,
        marks: [] as string[],
        now: () => clock.time,
        mark: (name: string) => {
            clock.marks.push(`mark ${name}`);
            return {} as PerformanceMark;
        },
        measure: (name: string, from?: string) => {
            clock.marks.push(`measure ${name} ${String(from)}`);
            return {} as PerformanceMeasure;
        },
    };
    return clock;
}

function recorder(clock = fakeClock()): { field: FieldRecorder; sent: FieldEvent[]; clock: ReturnType<typeof fakeClock> } {
    const sent: FieldEvent[] = [];
    const field = new FieldRecorder(clock, (event) => sent.push(event));
    return { field, sent, clock };
}

describe('field measurements', () => {
    it('happyPath_eachBootPhaseIsTimedOnceFromTheEnginesStart', () => {
        const { field, sent, clock } = recorder();
        clock.time = 1250.4;
        field.record({ kind: 'phase', phase: 'manifest' });
        clock.time = 1800;
        field.record({ kind: 'phase', phase: 'map_render' });
        field.record({ kind: 'phase', phase: 'map_render' });
        clock.time = 2600.6;
        field.record({ kind: 'phase', phase: 'map_idle' });

        expect(sent).toEqual([
            { name: 'viewer_timing', params: { phase: 'manifest', duration_ms: 250, since_start_ms: 1250 } },
            { name: 'viewer_timing', params: { phase: 'map_render', duration_ms: 800, since_start_ms: 1800 } },
            { name: 'viewer_timing', params: { phase: 'map_idle', duration_ms: 1601, since_start_ms: 2601 } },
        ]);
        expect(clock.marks).toEqual([
            'mark hcm:boot',
            'mark hcm:manifest',
            'measure hcm:manifest hcm:boot',
            'mark hcm:map_render',
            'measure hcm:map_render hcm:boot',
            'mark hcm:map_idle',
            'measure hcm:map_idle hcm:boot',
        ]);
    });

    it('badPath_failuresAreSentAsTheyHappen', () => {
        const { field, sent } = recorder();
        field.record({ kind: 'manifest_error', code: 'error.manifest.notFound', retryable: true });
        field.record({ kind: 'map_unavailable', reason: 'style' });
        field.record({ kind: 'map_unavailable', reason: 'context_lost' });

        expect(sent).toEqual([
            { name: 'manifest_error', params: { code: 'error.manifest.notFound', retryable: true } },
            { name: 'map_unavailable', params: { reason: 'style' } },
            { name: 'map_unavailable', params: { reason: 'context_lost' } },
        ]);
    });

    it('badPath_aStormOfTileErrorsIsCountedNotSentOneByOne', () => {
        const { field, sent, clock } = recorder();
        for (let tile = 0; tile < 40; tile += 1) {
            field.record({ kind: 'map_error', errorKind: 'tile' });
        }
        field.record({ kind: 'map_error', errorKind: 'source' });
        expect(sent).toEqual([
            { name: 'map_errors', params: { error_kind: 'tile', error_count: 1 } },
            { name: 'map_errors', params: { error_kind: 'source', error_count: 1 } },
        ]);

        clock.time += MAP_ERROR_INTERVAL_MS;
        field.record({ kind: 'map_error', errorKind: 'tile' });
        expect(sent.at(-1)).toEqual({ name: 'map_errors', params: { error_kind: 'tile', error_count: 40 } });

        field.record({ kind: 'map_error', errorKind: 'tile' });
        field.record({ kind: 'map_error', errorKind: 'tile' });
        field.flush();
        field.flush();
        expect(sent.slice(3)).toEqual([{ name: 'map_errors', params: { error_kind: 'tile', error_count: 2 } }]);
    });

    it('happyPath_aPhotoAndCompareAreTimedFromTheirStart', () => {
        const { field, sent, clock } = recorder();
        field.record({ kind: 'start', what: 'photo' });
        clock.time += 420.2;
        field.record({ kind: 'end', what: 'photo', ok: true });
        field.record({ kind: 'start', what: 'compare' });
        clock.time += 1500;
        field.record({ kind: 'end', what: 'compare', ok: false });

        expect(sent).toEqual([
            { name: 'photo_timing', params: { duration_ms: 420, outcome: 'ok' } },
            { name: 'compare_timing', params: { duration_ms: 1500, outcome: 'failed' } },
        ]);
    });

    it('badPath_anEndWithoutAStartSendsNothing', () => {
        const { field, sent } = recorder();
        field.record({ kind: 'end', what: 'photo', ok: false });
        field.record({ kind: 'end', what: 'compare', ok: true });
        field.record({ kind: 'start', what: 'photo' });
        field.record({ kind: 'end', what: 'photo', ok: false });
        field.record({ kind: 'end', what: 'photo', ok: true });

        expect(sent).toEqual([{ name: 'photo_timing', params: { duration_ms: 0, outcome: 'failed' } }]);
    });

    it('badPath_aBrowserWithoutUserTimingStillMeasures', () => {
        const clock = fakeClock();
        const broken: FieldClock = {
            now: clock.now,
            mark: () => {
                throw new TypeError('mark');
            },
            measure: clock.measure,
        };
        const sent: FieldEvent[] = [];
        const field = new FieldRecorder(broken, (event) => sent.push(event));
        field.record({ kind: 'phase', phase: 'manifest' });

        expect(sent).toHaveLength(1);
    });
});
