import type { CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { toSetupStatusView } from './view.js';

export type StatusDeps = Pick<Ports, 'setup' | 'clock' | 'log'>;

/**
 * `setup.status` (admin): the Setup Assistant's whole screen, six areas and `ready` (M2-interfaces §3.3). Reads
 * `setup/status` leniently through `SetupRecords`, so one malformed field falls back to its default instead of
 * failing the screen, and only the fields of the view schema leave the function.
 */
export async function setupStatus(deps: StatusDeps, caller: VerifiedCaller): Promise<CallableResponse<'setup.status'>> {
    const view = toSetupStatusView((await deps.setup.readStatus()) ?? {}, deps.clock.now());
    deps.log.info('setup status read', { uid: caller.uid, ready: view.ready });
    return view;
}
