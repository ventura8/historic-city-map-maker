/** The `telemetry` family: exactly the registry's telemetry callable and HTTPS endpoint. */
import { CALLABLES, HTTP_ENDPOINTS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { telemetryFunctions } from '../../src/telemetry/index.js';
import { registryKeys, sorted } from '../admin/world.js';

describe('telemetry family', () => {
    it('happyPath_theFamilyHasExactlyItsRegistryFunctions', () => {
        const family = telemetryFunctions((): never => {
            throw new Error('the dependencies are created by the first call, never when the functions are defined');
        });

        const expected = [...registryKeys(Object.keys(CALLABLES), 'telemetry'), ...registryKeys(Object.keys(HTTP_ENDPOINTS), 'telemetry')];
        expect(sorted(Object.keys(family))).toEqual(sorted(expected));
    });
});
