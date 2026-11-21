import { translateAdminShell } from '@hcm/shared';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { seedPublicCity } from '../../support/flows.js';
import { contentText } from '../../support/ops.js';
import { seedLayer } from '../settings/world.js';

/**
 * What the public map leaves out (docs/research/M2c-interfaces.md §5.4; behaviour A38; DECISIONS-for-review.md §42b) in a
 * city of the admin's own: a published layer without its attribution is skipped by the manifest build (which never fails
 * for one document), and the dashboard's **Not on the public map** lists it with its first issue and a link to its editor.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

test(
    'A layer the public map skipped is listed on the dashboard with its first issue, and its link opens its editor',
    { tag: ['@S-A38-BAD-SKIPPED-SHOWN'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await seedPublicCity(content, AT);
        // Published without its attribution: the build leaves it out and records why.
        await seedLayer(content, 'corona-1968', AT);
        await expect
            .poll(async () => JSON.stringify((await content.emulators.document(`manifests/${content.city}`))?.['skipped'] ?? []), {
                message: 'the build records the skipped layer',
                timeout: FUNCTIONS_TIMEOUT_MS,
            })
            .toContain('corona-1968');

        await page.goto(content.address(lang, 'home', { map: false }));
        const list = page.getByRole('list', { name: translateAdminShell(lang, 'adminShell.home.notOnMap') });
        const item = list.getByRole('listitem');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText(contentText(lang, 'adminContent.field.attribution'));
        const link = item.getByRole('link', { name: `${contentText(lang, 'adminContent.history.one.layer')} corona-1968` });
        await expect(link).toHaveAttribute('href', '#/layers/corona-1968');
        await expectStateSound(page, adminVisit('home.skipped', lang));

        await link.click();
        await expect(page.getByRole('heading', { level: 2, name: 'Corona 1968' })).toBeVisible();
    },
);
