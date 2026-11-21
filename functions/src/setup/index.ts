import '../global-options.js';

import { defineCallable, type CallableDeps } from '../api/callable.js';
import { analyticsConfig, type AnalyticsConfigDeps } from './analytics-config.js';
import { createCity, type CreateCityDeps } from './create-city.js';
import { recordCloud, type RecordCloudDeps } from './record-cloud.js';
import { rotatePublicToken, type RotatePublicTokenDeps } from './rotate-public-token.js';
import { saveMapbox, type SaveMapboxDeps } from './save-mapbox.js';
import { saveUsgs, type SaveUsgsDeps } from './save-usgs.js';
import { selfTest } from './self-test.js';
import type { SelfTestDeps } from './self-test-checks.js';
import { setupStatus, type StatusDeps } from './status.js';

/** Every port the `setup.*` callables use (the composition root's `Ports` provides them all). */
export type SetupDeps = CallableDeps &
    StatusDeps &
    SelfTestDeps &
    RecordCloudDeps &
    CreateCityDeps &
    SaveMapboxDeps &
    SaveUsgsDeps &
    RotatePublicTokenDeps &
    AnalyticsConfigDeps;

/**
 * The `setup.*` callables of the registry (`CALLABLES`, owner fn-setup; M2-interfaces §3.3), built on the shared
 * plumbing: access rule, App Check mode and `maxInstances` from the registry, validated requests and responses, error
 * codes. `functions/src/index.ts` exports the result as the `setup` group, so each deploys as `setup-<name>`
 * (`deployedName`), with `getDeps` from `deps.ts` (CR-M2-13). Dependencies are resolved on the first call, not at load.
 */
export function defineSetupFunctions(getDeps: () => SetupDeps) {
    return {
        status: defineCallable('setup.status', setupStatus, getDeps),
        selfTest: defineCallable('setup.selfTest', selfTest, getDeps),
        recordCloud: defineCallable('setup.recordCloud', recordCloud, getDeps),
        createCity: defineCallable('setup.createCity', createCity, getDeps),
        saveMapbox: defineCallable('setup.saveMapbox', saveMapbox, getDeps),
        saveUsgs: defineCallable('setup.saveUsgs', saveUsgs, getDeps),
        rotatePublicToken: defineCallable('setup.rotatePublicToken', rotatePublicToken, getDeps),
        analyticsConfig: defineCallable('setup.analyticsConfig', analyticsConfig, getDeps),
    };
}
