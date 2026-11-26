import { expect, test } from '../../support/content-test.js';
import { contentText, seedCity, seedJob, seedLogLine } from '../../support/ops.js';

/**
 * A job's live log when the connection drops (docs/research/M2c-interfaces.md §9.3; behaviour A18), in a city of the admin's
 * own: Firestore's listen channel is cut for a while (its requests fail as a dropped connection would, the one already open
 * included), the page says it is reconnecting, a line the pipeline writes meanwhile arrives once the channel is back, and no
 * line shows twice.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** Firestore's listen channel of the emulator (WebChannel): what a dropped connection cuts. */
const LISTEN = /\/google\.firestore\.v1\.Firestore\/Listen\/channel/;

/** What the cut logs: the requests the route reset or the offline browser failed, and Firestore's refused network probe. */
const CUT = /ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|Listen\/channel|cleardot\.gif/;

test(
    'A dropped listener says it is reconnecting and resumes without a line twice',
    { tag: ['@S-A18-BAD-STREAM-DROP'] },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await seedCity(content, AT);
        await seedJob(
            content,
            'scan-1',
            {
                type: 'usgs-import',
                status: 'running',
                createdBy: content.uid,
                progress: 0.4,
                step: 'fetch',
                steps: { fetch: { status: 'running' } },
            },
            AT,
        );
        await seedLogLine(content, 'scan-1', 1, 'Fetching the scene', AT);
        await page.goto(content.address(lang, 'jobs/scan-1', { map: false }));
        await expect(page.getByText('Fetching the scene')).toHaveCount(1);

        // The connection drops: every listen request fails; the page says it is reconnecting. A route reaches only the
        // requests that start after it, and the channel's long poll already open stayed open 45 s on a loaded machine
        // (docs/LESSONS.md 236), so the browser also goes offline until the page says so: that fails the open request too.
        await page.route(LISTEN, (route) => route.abort('connectionreset'));
        await page.context().setOffline(true);
        await expect(
            page
                .getByRole('status')
                .filter({ hasText: contentText(lang, 'adminContent.common.reconnecting') })
                .first(),
        ).toBeVisible({
            timeout: 60_000,
        });
        await page.context().setOffline(false);
        await seedLogLine(content, 'scan-1', 2, 'Downloading 812 MB', AT);

        // Back: the line written meanwhile shows, and every line once.
        await page.unroute(LISTEN);
        await expect(page.getByText('Downloading 812 MB')).toHaveCount(1, { timeout: 60_000 });
        await expect(page.getByText('Fetching the scene')).toHaveCount(1);
        await expect(page.getByRole('status').filter({ hasText: contentText(lang, 'adminContent.common.reconnecting') })).toHaveCount(0);
        // The cut requests are logged (reset by the route, or failed offline), and so is Firestore's network probe (an image of
        // www.google.com) that the admin's CSP refuses: it loads no third-party image.
        expect(consoleErrors.takeMatching(CUT).length).toBeGreaterThan(0);
    },
);
