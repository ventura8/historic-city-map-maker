/**
 * Home's reminders (M6 setup-ux, `docs/research/M6-interfaces.md` §4.1, §3.1; A59, A60): USGS later or waiting for its
 * approval, and a likely free trial from 14 days before its 90th day until the owner calls it paid.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { HOME_MODULE } from '../../src/home/home.js';
import { TRIAL_DAYS, TRIAL_REMINDER_DAYS, remindersOf } from '../../src/home/reminders.js';
import { at, contentWorld } from '../content/world.js';
import { statusView } from '../setup/harness.js';

const DAY_MS = 86_400_000;
const SINCE = Date.parse('2026-08-01T10:00:00Z');
const STAMP = { updatedBy: 'system:ops', updatedAt: at('2026-10-17T10:00:00Z') };
const UPGRADE = 'https://console.cloud.google.com/billing';

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('remindersOf', () => {
    it('happyPath_usgsLaterAndWaitingAreReminded', () => {
        expect(remindersOf({ usgs: { state: 'missing', postponedAt: at('2026-10-25T10:00:00Z') }, ...STAMP }, SINCE)).toEqual([
            { kind: 'usgsLater' },
        ]);
        const pending = { state: 'pending', detail: 'apiError.usgs.accessPending', pendingSince: at('2026-10-20T08:00:00Z') } as const;
        expect(remindersOf({ usgs: pending, ...STAMP }, SINCE)).toEqual([{ kind: 'usgsPending', since: '2026-10-20T08:00:00.000Z' }]);
        expect(remindersOf({ usgs: { state: 'pending', detail: 'apiError.usgs.accessPending' }, ...STAMP }, SINCE)).toEqual([
            { kind: 'usgsPending', since: null },
        ]);
    });

    it('happyPath_aLikelyTrialIsRemindedFourteenDaysBeforeItsEnd', () => {
        const status = { billing: { state: 'ok', trialSince: at('2026-08-01T10:00:00Z') }, ...STAMP } as const;
        const end = SINCE + TRIAL_DAYS * DAY_MS;

        expect(remindersOf(status, end - TRIAL_REMINDER_DAYS * DAY_MS - 1)).toEqual([]);
        expect(remindersOf(status, end - TRIAL_REMINDER_DAYS * DAY_MS)).toEqual([
            { kind: 'trial', endsAt: new Date(end).toISOString(), upgradeUrl: UPGRADE },
        ]);
        expect(remindersOf(status, end + DAY_MS)).toHaveLength(1);
    });

    it('badPath_nothingOpenAPaidTrialOrNoStatusRemindsNothing', () => {
        expect(remindersOf(null, SINCE)).toEqual([]);
        expect(remindersOf({ usgs: { state: 'ok' }, billing: { state: 'ok' }, ...STAMP }, SINCE)).toEqual([]);
        expect(remindersOf({ usgs: { state: 'invalid', detail: 'apiError.usgs.credentials' }, ...STAMP }, SINCE)).toEqual([]);
        const paid = {
            billing: { state: 'ok', trialSince: at('2026-08-01T10:00:00Z'), trialPaidAt: at('2026-10-01T10:00:00Z') },
            ...STAMP,
        };
        expect(remindersOf(paid as never, SINCE + TRIAL_DAYS * DAY_MS)).toEqual([]);
    });
});

describe('the dashboard: reminders', () => {
    it('happyPath_itIsAPaidAccountIsRecordedAndTheLiveStatusDropsTheReminder', async () => {
        const world = contentWorld();
        world.clock.current = SINCE + 80 * DAY_MS;
        world.store.docs.set(FIRESTORE_PATHS.setupStatus, { billing: { state: 'ok', trialSince: at('2026-08-01T10:00:00Z') }, ...STAMP });
        world.callables.answer('setup.recordCloud', () => ({ status: statusView() }));
        const home = HOME_MODULE.create(world.services);

        home.open([]);
        await settled();
        expect(home.state.reminders.map((reminder) => reminder.kind)).toEqual(['trial']);

        await home.intents.dismissTrial();

        expect(world.callables.calls.filter((call) => call.name === 'setup.recordCloud').map((call) => call.request)).toEqual([
            { trial: { paid: true } },
        ]);
        expect(home.state.dismissing).toBe(false);
        expect(world.notices).toEqual([]);
    });

    it('badPath_aRefusedDismissalIsSaidAndTheReminderStays', async () => {
        const world = contentWorld();
        world.clock.current = SINCE + 80 * DAY_MS;
        world.store.docs.set(FIRESTORE_PATHS.setupStatus, { billing: { state: 'ok', trialSince: at('2026-08-01T10:00:00Z') }, ...STAMP });
        const home = HOME_MODULE.create(world.services);
        home.open([]);
        await settled();

        await home.intents.dismissTrial();

        expect(world.notices).toEqual([{ key: 'apiError.internal' }]);
        expect(home.state.reminders).toHaveLength(1);
    });
});
