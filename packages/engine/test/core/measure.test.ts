import { describe, expect, it } from 'vitest';

import type { Measurement } from '../../src/telemetry/telemetry-port.js';
import { FakeCompare } from '../compare/support.js';
import { harness, loaded } from './harness.js';
import { jsonResponse, settle } from './support.js';

/**
 * The field measurements the boot and the store report to telemetry (docs/ARCHITECTURE.md → *Field measurements*,
 * DECISIONS-for-review.md §76); telemetry's own timing and sending are tested in `../telemetry/`.
 */

/** The measurements without the error toasts' `ui_error` (§200), which each test of a failure also shows. */
function withoutToasts(measures: readonly Measurement[]): Measurement[] {
    return measures.filter((measure) => measure.kind !== 'ui_error');
}

describe('field measurements of the boot', () => {
    it('happyPath_theManifestTheFirstRenderAndTheFirstIdleAreReported', async () => {
        const { map, telemetry } = await loaded();
        map.emit('idle', undefined);

        expect(telemetry.measures).toEqual([
            { kind: 'phase', phase: 'manifest' },
            { kind: 'phase', phase: 'map_render' },
            { kind: 'phase', phase: 'map_idle' },
        ]);
    });

    it('badPath_aMissingManifestIsReportedWithItsCode', async () => {
        const { telemetry } = await loaded({ response: () => Promise.resolve(jsonResponse({}, 404)) });

        expect(telemetry.measures).toEqual([{ kind: 'manifest_error', code: 'error.manifest.notFound', retryable: true }]);
    });

    it('badPath_noWebGlAFailedStyleAndNoContainerAreReported', async () => {
        const noWebGl = await loaded({ map: { webgl: false } });
        const style = await loaded({ map: { mountError: new Error('style') } });
        const webgl = await loaded({ map: { mountError: new Error('webgl') } });
        const container = await loaded({ container: null });

        expect(noWebGl.telemetry.measures.at(-1)).toEqual({ kind: 'map_unavailable', reason: 'unsupported' });
        expect(style.telemetry.measures.at(-1)).toEqual({ kind: 'map_unavailable', reason: 'style' });
        expect(webgl.telemetry.measures.at(-1)).toEqual({ kind: 'map_unavailable', reason: 'webgl' });
        expect(container.telemetry.measures.at(-1)).toEqual({ kind: 'map_unavailable', reason: 'container' });
    });

    it('badPath_mapErrorsAndALostContextAreReportedByKind', async () => {
        const { map, telemetry } = await loaded();
        map.emit('error', { kind: 'tile', message: 'Not Found' });
        map.emit('error', { kind: 'source', layerId: 'kh9-1980', message: 'gone' });
        map.emit('webglcontextlost', undefined);

        // The error toasts the map's errors show are measured too (§200), by their keys.
        expect(telemetry.measures.filter((measure) => measure.kind === 'ui_error').length).toBeGreaterThan(0);
        expect(withoutToasts(telemetry.measures.slice(2))).toEqual([
            { kind: 'map_error', errorKind: 'tile' },
            { kind: 'map_error', errorKind: 'source' },
            { kind: 'map_unavailable', reason: 'context_lost' },
        ]);
    });
});

describe('field measurements of the store', () => {
    it('happyPath_aPhotoOpensThenItsThumbnailIsShown', async () => {
        const { store, telemetry } = await loaded();
        store.openPhoto('uranus-1936');
        store.openPhoto('uranus-1936');
        store.photoShown(true);

        expect(withoutToasts(telemetry.measures.slice(2))).toEqual([
            { kind: 'start', what: 'photo' },
            { kind: 'end', what: 'photo', ok: true },
        ]);
    });

    it('badPath_anUnknownPhotoStartsNoMeasurement', async () => {
        const { store, telemetry } = await loaded();
        store.openPhoto('no-such-photo');
        store.photoShown(false);

        expect(withoutToasts(telemetry.measures.slice(2))).toEqual([{ kind: 'end', what: 'photo', ok: false }]);
    });

    it('happyPath_compareIsTimedUntilItsSecondMapIsReady', async () => {
        const compare = new FakeCompare();
        const { store, telemetry } = await loaded({ compare });
        store.setWindowSize(1280, 800);
        store.openCompare('kh9-1980');
        await settle();

        expect(withoutToasts(telemetry.measures.slice(2))).toEqual([
            { kind: 'start', what: 'compare' },
            { kind: 'end', what: 'compare', ok: true },
        ]);
    });

    it('badPath_aCompareWhoseMapOrChunkFailsEndsFailed', async () => {
        const failing = new FakeCompare();
        failing.mapOptions = { mountError: new Error('style') };
        const map = await loaded({ compare: failing });
        map.store.setWindowSize(1280, 800);
        map.store.openCompare(null);
        await settle();
        const chunk = new FakeCompare();
        chunk.loadError = new Error('network');
        const missing = harness({ compare: chunk });
        await missing.store.load();
        await settle();
        missing.store.openCompare(null);
        await settle();

        const failed = [
            { kind: 'start', what: 'compare' },
            { kind: 'end', what: 'compare', ok: false },
        ];
        expect(withoutToasts(map.telemetry.measures.slice(2))).toEqual(failed);
        expect(withoutToasts(missing.telemetry.measures.slice(2))).toEqual(failed);
    });
});
