import { ADMIN_EVENT_PARAMS, createLogger, SURFACE_PARAMS, VIEWER_EVENT_PARAMS } from '@hcm/shared';
import { createUpstreamFakes, GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createMeasurementReports, FIELD_DIMENSIONS, FIELD_METRICS } from '../../src/google/analytics-reports.js';

/**
 * §76f: Create the measurement reports against the fake Google Analytics Admin API (`v1beta`): the property found from
 * the measurement id through the account summaries and each property's streams, every field parameter registered once.
 */

const MEASUREMENT_ID = 'G-E2E0000000';

function world() {
    const fakes = createUpstreamFakes();
    fakes.scenario('firebase-management.analyticsLinked');
    const options = {
        fetch: fakes.fetch,
        token: () => GOOGLE_TOKENS.owner,
        sleep: () => Promise.resolve(),
        log: createLogger('test', { minLevel: 'error' }),
    };
    return { fakes, run: (id = MEASUREMENT_ID) => createMeasurementReports(options, id) };
}

describe('createMeasurementReports', () => {
    it('happyPath_everyFieldParameterIsRegisteredOnTheStreamsPropertyOnce', async () => {
        const { fakes, run } = world();

        await expect(run()).resolves.toEqual({ created: 26, skipped: 0 });

        const created = fakes.callsTo('analytics-admin.customDimensions.create').map((call) => JSON.parse(call.body) as unknown);
        expect(created).toContainEqual({ parameterName: 'metric_name', displayName: 'metric_name', scope: 'EVENT' });
        expect(fakes.callsTo('analytics-admin.customMetrics.create').map((call) => JSON.parse(call.body) as unknown)).toEqual([
            { parameterName: 'metric_value', displayName: 'metric_value', scope: 'EVENT', measurementUnit: 'MILLISECONDS' },
            { parameterName: 'duration_ms', displayName: 'duration_ms', scope: 'EVENT', measurementUnit: 'MILLISECONDS' },
            { parameterName: 'error_count', displayName: 'error_count', scope: 'EVENT', measurementUnit: 'STANDARD' },
            { parameterName: 'attempt', displayName: 'attempt', scope: 'EVENT', measurementUnit: 'STANDARD' },
        ]);
        expect(new URL(fakes.callsTo('analytics-admin.customMetrics.create')[0]?.url ?? '').pathname).toBe(
            '/v1beta/properties/400000001/customMetrics',
        );
    });

    it('happyPath_aSecondRunCreatesNothing_andARegisteredParameterIsSkipped', async () => {
        const { fakes, run } = world();
        await run();

        await expect(run()).resolves.toEqual({ created: 0, skipped: 26 });
        expect(fakes.callsTo('analytics-admin.customDimensions.create')).toHaveLength(FIELD_DIMENSIONS.length);
    });

    it('badPath_noPropertyTheOwnerCanSeeSendsTheIdGivesNull', async () => {
        const other = world();
        other.fakes.scenario('analytics-admin.otherAccount');
        await expect(other.run()).resolves.toBeNull();

        const unknown = world();
        await expect(unknown.run('G-NOT0THERS')).resolves.toBeNull();
        expect(unknown.fakes.callsTo('analytics-admin.customDimensions.create')).toHaveLength(0);
    });

    it('badPath_aRefusedPropertyIsAGoogleFailureNamingTheEditorRole', async () => {
        const { fakes, run } = world();
        fakes.fail('analytics-admin', 'forbidden');

        await expect(run()).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('happyPath_everyRegisteredParameterIsOneTheFieldEventsSend', () => {
        // The list follows docs/ADMIN_GUIDE.*.md and the guard's schemas of @hcm/shared: no definition GA4 would never fill.
        const events = [...Object.values(ADMIN_EVENT_PARAMS), ...Object.values(VIEWER_EVENT_PARAMS), SURFACE_PARAMS];
        const sent = new Set(events.flatMap((params) => Object.keys(params)));

        expect([...FIELD_DIMENSIONS, ...Object.keys(FIELD_METRICS)].filter((name) => !sent.has(name))).toEqual([]);
    });
});
