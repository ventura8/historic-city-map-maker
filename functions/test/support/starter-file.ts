/** The starter files as the function serves them (`functions/src/worker/starter.ts`), for the tests of `functions/test/worker/starter*.test.ts`. */
import type { WorkerOs } from '@hcm/shared';

import { createDiskStarterTemplates } from '../../src/adapters/starter-templates.js';
import { handleStarterRequest, type StarterDeps } from '../../src/worker/starter.js';
import { recordingLogger } from './fakes.js';

export const TEMPLATES = new URL('../../../packages/admin/starter/', import.meta.url);
export const CITY = 'bucharest';

export async function starterFile(
    os: WorkerOs,
    action: 'install' | 'uninstall',
): Promise<Awaited<ReturnType<typeof handleStarterRequest>>> {
    const { log } = recordingLogger();
    const deps: StarterDeps = {
        log,
        starters: createDiskStarterTemplates(TEMPLATES),
        config: { projectId: 'demo-hcm' } as StarterDeps['config'],
    };
    return handleStarterRequest(deps, { method: 'GET', query: { city: CITY, os, action } });
}
