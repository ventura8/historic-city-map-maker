/**
 * Home's reminders (M6 setup-ux, `docs/research/M6-interfaces.md` §4.1, §3.1; A59, A60): USGS later with Set up USGS,
 * USGS waiting for its approval with its date, a likely free trial with the upgrade link and "It is a paid account".
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HomeIntentsPort, HomeViewState } from '../../../src/admin/home/home-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { homeState, page } from '../ops/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll } from '../shell/fake-app.js';

const UPGRADE = 'https://console.cloud.google.com/billing';

describe('<hcm-home-page> reminders', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_eachReminderSaysWhatIsOpenWithItsAction', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(
            homeState({
                reminders: [
                    { kind: 'usgsLater' },
                    { kind: 'usgsPending', since: '2026-10-12T09:00:00.000Z' },
                    { kind: 'trial', endsAt: '2026-10-30T10:00:00.000Z', upgradeUrl: UPGRADE },
                ],
            }),
            { dismissTrial: Promise.resolve() },
        );
        const { element } = await page('home', home);

        const tiles = deepAll(element, 'li.reminder');
        expect(tiles.map((tile) => tile.dataset['reminder'])).toEqual(['usgsLater', 'usgsPending', 'trial']);
        expect(deepText(element)).toContain('USGS is not set up yet: historical imagery search is off.');
        expect(deepText(element)).toContain('(since 12 Oct 2026)');
        expect(deepText(element)).toContain('ending around 30 Oct 2026');
        expect(deepAll(element, 'li.reminder a.action').map((link) => link.getAttribute('href'))).toEqual([
            '#/setup/usgs',
            '#/setup/usgs',
            UPGRADE,
        ]);
        deep(element, 'li[data-reminder="trial"] hcm-button').click();
        expect(home.named('dismissTrial')).toEqual(['dismissTrial']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_nothingOpenShowsNoRemindersAndAPendingDateNotKnownIsAnEllipsis', async () => {
        const none = new FakeArea<HomeViewState, HomeIntentsPort>(homeState());
        const empty = await page('home', none);
        expect(deepAll(empty.element, 'li.reminder')).toEqual([]);
        cleanup();

        const pending = new FakeArea<HomeViewState, HomeIntentsPort>(
            homeState({ reminders: [{ kind: 'usgsPending', since: null }], dismissing: true }),
        );
        const { element } = await page('home', pending);
        expect(deepText(element)).toContain('(since …)');
    });
});
