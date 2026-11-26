/** The `admin` and `admins` families export exactly the registry's callables (`CALLABLES` of `@hcm/shared`). */
import { CALLABLES } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { adminFunctions, adminsFunctions } from '../../src/admin/index.js';
import { registryKeys, sorted } from './world.js';

const NAMES = Object.keys(CALLABLES);

describe('admin families', () => {
    it('happyPath_eachFamilyHasExactlyItsRegistryFunctions', () => {
        const getDeps = (): never => {
            throw new Error('the dependencies are created by the first call, never when the functions are defined');
        };

        expect(sorted(Object.keys(adminFunctions(getDeps)))).toEqual(sorted(registryKeys(NAMES, 'admin')));
        expect(sorted(Object.keys(adminsFunctions(getDeps)))).toEqual(sorted(registryKeys(NAMES, 'admins')));
    });
});
