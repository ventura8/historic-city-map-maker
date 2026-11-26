// `npm run build:self-host` (at a release, after `npm run build`): assembles create-historic-city's self-host bundle,
// dist/self-host/, from the admin's production build, the functions' artifact, the rules and firebase.json. The logic and
// its documentation are src/self-host/bundle.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { buildSelfHostBundle, DEFAULT_LAYOUT } from './src/self-host/bundle.js';

const log = createLogger('self-host-bundle');
try {
    log.info('self-host bundle built', { ...buildSelfHostBundle({ root: process.cwd(), ...DEFAULT_LAYOUT }) });
} catch (error: unknown) {
    log.error(String(error));
    process.exitCode = 1;
}
