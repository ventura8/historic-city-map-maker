import { apiErrorDetails, type AdminCallableName } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { measuredCallables } from '../../src/app/field-actions.js';
import type { AdminFieldEvent } from '../../src/app/telemetry.js';
import { CallableFailure, type CallablesPort } from '../../src/firebase/ports.js';

function world(answer: (name: AdminCallableName) => Promise<unknown>) {
    const events: AdminFieldEvent[] = [];
    let now = 1000;
    const inner = { call: (name: AdminCallableName) => answer(name) } as unknown as CallablesPort;
    const callables = measuredCallables(
        inner,
        (event) => {
            events.push(event);
        },
        () => {
            now += 250;
            return now;
        },
    );
    return { callables, events };
}

describe('measuredCallables', () => {
    it('happyPath_aJourneyStepIsMeasuredWithItsOutcomeAndDuration', async () => {
        const { callables, events } = world(() => Promise.resolve({ jobId: 'j1' }));

        await callables.call('imagery.approve', { cityId: 'bucharest', versionId: 'v1' });

        expect(events).toEqual([{ name: 'admin_action', params: { action: 'imagery_approve', outcome: 'ok', duration_ms: 250 } }]);
    });

    it('badPath_aRefusalIsMeasuredByItsCodeAndStillThrown', async () => {
        const refusal = new CallableFailure('failed-precondition', apiErrorDetails('apiError.invalidRequest'));
        const { callables, events } = world(() => Promise.reject(refusal));

        await expect(callables.call('imagery.import', {} as never)).rejects.toBe(refusal);

        expect(events[0]?.params).toMatchObject({ action: 'imagery_import', outcome: 'apiError.invalidRequest' });
    });

    it('badPath_aFailureWithoutACodeIsAnErrorAndOtherCallsAreNotMeasured', async () => {
        const { callables, events } = world((name) =>
            name === 'imagery.join' ? Promise.reject(new Error('offline')) : Promise.resolve({}),
        );

        await callables.call('setup.status', {});
        await expect(callables.call('imagery.join', {} as never)).rejects.toThrow('offline');

        expect(events.map((event) => event.params['outcome'])).toEqual(['error']);
    });
});
