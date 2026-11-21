import { describe, expect, it } from 'vitest';

import { MAX_PENDING } from '../../src/telemetry/analytics.js';
import type { FieldEvent } from '../../src/telemetry/telemetry-port.js';
import { recordingLog, settle } from '../core/support.js';
import { FIELD_CONTEXT, IDS, PAGE, fakeField, fakeSdk, loader } from './support.js';

const TIMING: FieldEvent = { name: 'viewer_timing', params: { phase: 'manifest', duration_ms: 120, since_start_ms: 400 } };
const LCP = {
    metric_name: 'LCP',
    metric_value: 1830,
    metric_delta: 1830,
    metric_id: 'v6-1-2',
    metric_rating: 'good',
    navigation_type: 'navigate',
    value: 1830,
};

describe('field measurements through analytics', () => {
    it('happyPath_aMeasurementBeforeConsentIsSentOnceConsentIsGranted', async () => {
        const sdk = fakeSdk();
        const { analytics, loads } = loader(sdk);
        analytics.send(TIMING);
        analytics.configure('G-TEST1234', IDS);
        await settle();
        expect(loads(), 'nothing loads before consent').toBe(0);

        analytics.setConsent('granted');
        await settle();

        expect(sdk.events).toEqual([['viewer_timing', { ...TIMING.params, ...FIELD_CONTEXT, app_surface: 'viewer', page_location: PAGE }]]);
    });

    it('badPath_aRefusalForgetsTheHeldMeasurementsAndNoneIsHeldAfterIt', async () => {
        const sdk = fakeSdk();
        const { analytics, loads } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.send(TIMING);
        analytics.setConsent('denied');
        analytics.send(TIMING);

        analytics.setConsent('granted');
        analytics.send({ name: 'share' });
        await settle();

        expect(loads()).toBe(1);
        expect(sdk.events.map(([name]) => name)).toEqual(['share']);
    });

    it('badPath_atMost30MeasurementsWaitForConsent', async () => {
        const sdk = fakeSdk();
        const { analytics } = loader(sdk);
        for (let index = 0; index < MAX_PENDING + 10; index += 1) {
            analytics.send({ name: 'photo_timing', params: { duration_ms: index, outcome: 'ok' } });
        }
        analytics.setConsent('granted');
        analytics.configure('G-TEST1234', IDS);
        await settle();

        expect(sdk.events).toHaveLength(MAX_PENDING);
    });

    it('happyPath_theCoreWebVitalsStartWithTheSdkAndReportWithTheirContext', async () => {
        const sdk = fakeSdk();
        const field = fakeField();
        const { analytics } = loader(sdk, recordingLog(), field);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();
        expect(field.reporters).toHaveLength(1);

        field.reporters[0]?.(LCP);
        await settle();

        expect(sdk.events.at(-1)).toEqual(['web_vitals', { ...LCP, ...FIELD_CONTEXT, app_surface: 'viewer', page_location: PAGE }]);
    });

    it('badPath_afterAWithdrawalAVitalIsDropped', async () => {
        const sdk = fakeSdk();
        const field = fakeField();
        const { analytics } = loader(sdk, recordingLog(), field);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();

        analytics.setConsent('denied');
        field.reporters[0]?.(LCP);
        await settle();

        expect(sdk.events.map(([name]) => name)).toEqual(['page_view']);
    });

    it('badPath_anEventThatRevealsAPositionIsDroppedAndSaidOnce', async () => {
        const sdk = fakeSdk();
        const log = recordingLog();
        const { analytics } = loader(sdk, log);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'exception', description: 'lost at 44.43012, 26.10031', fatal: false });
        analytics.send({ name: 'exception', description: 'view #15/44.4/26.1', fatal: false });
        analytics.send({ name: 'photo_open', photoId: 'p/1' });
        analytics.send({ name: 'exception', description: 'TypeError: x', fatal: false });
        await settle();

        expect(sdk.events).toEqual([
            ['exception', { description: 'TypeError: x', fatal: false, app_surface: 'viewer', page_location: PAGE }],
        ]);
        expect(log.records.filter((record) => record.message === 'analytics event dropped').map((record) => record.data)).toEqual([
            { name: 'exception', reason: 'privacy' },
            { name: 'photo_open', reason: 'schema' },
        ]);
    });

    it('badPath_aFloodIsCappedByThePagesBudget', async () => {
        const sdk = fakeSdk();
        const { analytics } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        for (let index = 0; index < 200; index += 1) {
            analytics.send({ name: 'map_errors', params: { error_kind: 'tile', error_count: 1 } });
        }
        await settle();

        expect(sdk.events.length).toBeLessThanOrEqual(30);
        expect(sdk.events.length).toBeGreaterThan(0);
    });

    it('badPath_aFieldChunkThatFailsToLoadSendsNothing', async () => {
        const sdk = fakeSdk();
        const log = recordingLog();
        const { analytics } = loader(sdk, log, new Error('field chunk 404'));
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();

        expect(sdk.events).toEqual([]);
        expect(log.messages()).toEqual(['analytics failed to load']);
    });
});
