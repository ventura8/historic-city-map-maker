/**
 * Which Setup step shows each install target, and the step's chip for each install state (`docs/research/M6-interfaces.md`
 * §1.7, §4.1): in place is done, a build under way waits, a stopped one needs attention.
 */
import type { InstallState, InstallTarget, ServiceState } from '@hcm/shared';

import type { SetupStepId } from './steps.js';

/** The step whose card shows each target. */
export const INSTALL_STEP_OF: Readonly<Record<InstallTarget, SetupStepId>> = { server: 'deploy', pipeline: 'pipeline', site: 'site' };

export const INSTALL_CHIP: Readonly<Record<InstallState, ServiceState>> = {
    notInstalled: 'missing',
    queued: 'pending',
    working: 'pending',
    retrying: 'pending',
    installed: 'ok',
    updateAvailable: 'ok',
    newerInstalled: 'ok',
    failed: 'invalid',
    unavailable: 'unavailable',
};
