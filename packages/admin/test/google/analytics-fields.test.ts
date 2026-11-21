import { describe, expect, it } from 'vitest';

import { usableParameters } from '../../src/google/analytics-fields.js';
import type { GoogleTransport } from '../../src/google/transport.js';

/** A transport whose one answer is the property's metadata. */
function metadata(answer: unknown): GoogleTransport {
    return { call: () => Promise.resolve(answer) } as unknown as GoogleTransport;
}

describe('usableParameters', () => {
    it('happyPath_theCustomDimensionsAndMetricsOfTheMetadataEachOnce', async () => {
        const transport = metadata({
            dimensions: [{ apiName: 'customEvent:step_id' }, { apiName: 'city' }],
            metrics: [{ apiName: 'averageCustomEvent:duration_ms' }, { apiName: 'countCustomEvent:step_id' }],
        });

        expect([...(await usableParameters(transport, 'properties/1', 'roles/viewer'))]).toEqual(['step_id', 'duration_ms']);
    });

    // A field without its name in the answer counts as no parameter, never as an error.
    it('badPath_aFieldWithoutItsNameIsLeftOut', async () => {
        const transport = metadata({ dimensions: [{ uiName: 'Step' }, { apiName: 'customEvent:app_surface' }] });

        expect([...(await usableParameters(transport, 'properties/1', 'roles/viewer'))]).toEqual(['app_surface']);
    });
});
