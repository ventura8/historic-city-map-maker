import { recordLiveRegions } from '../support/live-regions.js';
import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { shellText } from '../admin/support/i18n.js';
import { contentText, dialog, layoutOf, seedCity, seedJob, seedLogLine } from '../admin/support/ops.js';

/**
 * The jobs (docs/research/M2c-interfaces.md §9.3; behaviour A18), in a city of the admin's own (the content world,
 * e2e/admin/support/content.ts): jobs arrive live as the raster pipeline would write them. The page follows the canonical list and detail layout of its
 * window (§1.2: both panes from 840 px of page, one pane with Back below, and on a phone the open item as a full-screen
 * editor without the navigation bar), and every screen and dialog on the way runs the generic layout and accessibility
 * checkers (the ops section of e2e/tour/states.ts).
 *
 * Part of the layout and accessibility tour (DECISIONS-for-review.md §34c): it runs at every tour project's viewport,
 * scheme and language (tier `tour` on every push, `tour-matrix` in `all` and nightly), in a city of its own, so it
 * needs no lock beside the admin tier.
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });
const AT = new Date('2026-10-17T09:00:00.000Z');
/**
 * When the waiting job may run: far ahead of the server's own clock, which is the wall clock's. A date of the test's own
 * week fell due as the week went on, and any test's `imagery.tick` then dispatched the job under the check that it
 * waits (`docs/LESSONS.md` 217).
 */
const LATER = new Date('2100-01-01T09:00:00.000Z');

test(
    'Jobs show live progress and logs, and a running job can be cancelled',
    {
        tag: [
            '@S-A18-HAPPY',
            '@S-A18-HAPPY-WAITING-JOB',
            '@S-A18-BAD-CANCEL-FINISHED',
            '@S-A18-HAPPY-EMPTY-HINT',
            '@S-A18-BAD-EMPTY-HINT-GONE',
            '@S-A29-HAPPY-LIST-DETAIL',
            '@S-A31-HAPPY-EDITORS',
            '@S-A21-BAD-LEAK-CHECK',
        ],
    },
    async ({ page, lang, content }) => {
        const owner = content.uid;
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        await page.goto(content.address(lang, 'jobs'));

        // No job yet, and where jobs come from (finding 44 of 2026-11-01); jobs then arrive live, as the pipeline queues
        // and runs them.
        await expect(page.getByText(contentText(lang, 'adminContent.jobs.empty'))).toBeVisible();
        const hint = page.getByText(contentText(lang, 'adminContent.jobs.emptyHint'));
        await expect(hint).toBeVisible();
        await expectStateSound(page, adminVisit('jobs.empty', lang));
        await seedJob(
            content,
            'scan-1',
            {
                type: 'usgs-import',
                status: 'running',
                createdBy: owner,
                progress: 0.4,
                step: 'fetch',
                steps: { fetch: { status: 'running' } },
            },
            AT,
        );
        await seedJob(content, 'old', { type: 'republish', status: 'succeeded', createdBy: owner, progress: 1 }, AT);
        await seedJob(
            content,
            'ld',
            { type: 'layer-delete', status: 'queued', createdBy: owner, params: { layerId: 'corona-1968' }, dispatchAt: LATER },
            AT,
        );
        await seedLogLine(content, 'scan-1', 1, 'Fetching the scene <DS1>', AT);
        const running = page.getByRole('link', { name: new RegExp(contentText(lang, 'adminContent.jobs.type.usgsImport')) });
        await expect(running).toBeVisible();
        await expect(hint).toHaveCount(0);
        await expectStateSound(page, adminVisit('jobs.list', lang));

        // The running job: progress, steps and log; a new log line shows at once.
        await running.click();
        const heading = page.getByRole('heading', { level: 2, name: contentText(lang, 'adminContent.jobs.type.usgsImport') });
        await expect(heading).toBeFocused();
        await expect(
            page.getByRole('progressbar', { name: contentText(lang, 'adminContent.jobs.progress', { percent: '40' }) }),
        ).toBeVisible();
        await expect(page.getByText('Fetching the scene <DS1>')).toBeVisible();
        await seedLogLine(content, 'scan-1', 2, 'Downloading 812 MB', AT);
        await expect(page.getByText('Downloading 812 MB')).toBeVisible();
        const { split, phone } = await layoutOf(page);
        await expect(page.getByRole('region', { name: contentText(lang, 'adminContent.jobs.listLabel'), exact: true })).toBeVisible({
            visible: split,
        });
        await expect(page.getByRole('navigation', { name: shellText(lang, 'adminShell.nav.label') })).toBeVisible({ visible: !phone });
        await expectStateSound(page, adminVisit('jobs.detail', lang));

        // Esc closes the item: the list shows again with the focus back on the job it opened.
        await page.keyboard.press('Escape');
        await expect(running).toBeFocused();
        await running.click();
        await expect(heading).toBeFocused();

        // Cancel asks first, then asks the job to stop.
        await page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.cancel') }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(dialog(page).getByRole('button', { name: contentText(lang, 'adminContent.jobs.keepRunning') })).toBeFocused();
        await expectStateSound(page, adminVisit('jobs.cancel-confirm', lang));
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.jobs.cancel') })
            .click();
        await expect.poll(async () => (await content.document(`jobs/scan-1`))?.['cancelRequested']).toBe(true);
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.stopping') })).toBeDisabled();

        // A finished job offers no Cancel; a job waiting for its date says when it may run.
        await page.goto(content.address(lang, 'jobs/old'));
        await expect(page.getByRole('heading', { level: 2, name: contentText(lang, 'adminContent.jobs.type.republish') })).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.cancel') })).toHaveCount(0);
        await page.goto(content.address(lang, 'jobs/ld'));
        await expect(page.getByText(new RegExp(contentText(lang, 'adminContent.jobs.waiting', { date: '.+' })))).toBeVisible();
    },
);

test(
    'A page whose chunk does not load says so, and Try again loads it',
    { tag: ['@S-A29-BAD-CHUNK-LOAD', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content, consoleErrors }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        // The jobs page's chunk (DECISIONS-for-review.md §34b) is lost once on the way, as a dropped connection or a deploy
        // that replaced it would lose it; the next request for it goes through.
        let lost = 0;
        await page.route(/\/jobs-[\w-]{8}\.js$/, async (route) => {
            lost += 1;
            await (lost === 1 ? route.abort('failed') : route.fallback());
        });
        await page.goto(content.address(lang, 'jobs'));

        const failed = page.getByRole('alert').filter({ hasText: shellText(lang, 'adminShell.page.failed') });
        await expect(failed).toBeVisible();
        await expectStateSound(page, adminVisit('page-failed', lang));
        await page.getByRole('button', { name: shellText(lang, 'adminShell.page.retry'), exact: true }).click();

        await expect(page.getByText(contentText(lang, 'adminContent.jobs.empty'))).toBeVisible();
        await expect(failed).toHaveCount(0);
        expect(lost).toBe(2);
        expect(consoleErrors.takeMatching(/jobs-[\w-]{8}\.js/)).toHaveLength(1);
    },
);
