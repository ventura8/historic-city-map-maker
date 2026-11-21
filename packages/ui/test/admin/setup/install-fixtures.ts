// The install cards' slice as the admin's install flows build it (packages/admin/src/install/model.ts; the ui tests
// cannot import the admin): every target not installed, unless a test says otherwise.
import { INSTALL_STEPS, type InstallTarget } from '@hcm/shared';

import type { InstallSliceView, InstallTargetViewPort } from '../../../src/admin/setup/setup-port.js';

function installTargetView(target: InstallTarget, changes: Partial<InstallTargetViewPort> = {}): InstallTargetViewPort {
    return {
        target,
        state: 'notInstalled',
        installedRelease: null,
        buildId: null,
        consoleUrl: null,
        startedAt: null,
        finishedAt: null,
        steps: INSTALL_STEPS[target].map((id) => ({ id, state: 'waiting' })),
        failedStep: null,
        log: [],
        fixInProvision: false,
        quota: null,
        missing: [],
        retryReason: null,
        retryAt: null,
        blocker: null,
        busy: false,
        error: null,
        checkedAt: null,
        ...changes,
    };
}

export type InstallChanges = Partial<Omit<InstallSliceView, InstallTarget>> &
    Partial<Record<InstallTarget, Partial<InstallTargetViewPort>>>;

export function installSliceView(changes: InstallChanges = {}): InstallSliceView {
    const { server, pipeline, site, ...rest } = changes;
    return {
        release: '1.0.0+abc1234',
        address: 'https://demo-hcm.web.app/',
        freeMinutes: 2500,
        estimates: { server: 85, pipeline: 20, site: 5 },
        siteTransferMegabytes: 60,
        server: installTargetView('server', server),
        pipeline: installTargetView('pipeline', pipeline),
        site: installTargetView('site', site),
        pipelineOff: null,
        provisionDue: [],
        ...rest,
    };
}
