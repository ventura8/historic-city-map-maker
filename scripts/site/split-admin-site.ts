// Splits a built Hosting tree for the admin's own site (DECISIONS-for-review.md §210) before a deploy from a checkout:
// `node --import ./scripts/site/register-ts.mjs scripts/site/split-admin-site.ts --config <firebase json> --site <site id>`.
// The logic and its documentation are in src/hosting/admin-site.ts (the site build's `hosting` step runs the same); this
// entry only wires Node to it. The caller checks first that the site is the project's own.
import process from 'node:process';
import { parseArgs } from 'node:util';

import { createLogger } from '@hcm/shared';

import { splitAdminSite } from './src/hosting/admin-site.js';

const log = createLogger('admin-site');
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { config: { type: 'string' }, site: { type: 'string' } },
    strict: true,
});
if (values.config === undefined || values.site === undefined) {
    log.error('usage: split-admin-site --config <firebase json> --site <site id>');
    process.exitCode = 2;
} else {
    const result = splitAdminSite({ config: values.config, siteId: values.site });
    log.info(result.split ? 'tree split for the admin site' : 'tree already split', { admin: `${result.adminOrigin}/admin/` });
}
