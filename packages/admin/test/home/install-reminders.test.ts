/**
 * Home's installation reminder (M6 installer, `docs/research/M6-interfaces.md` §1.7; A55–A57): a target recorded
 * `failed` first, else one recorded `updateAvailable`, each opening the Setup step whose card acts on it.
 */
import { PROVISION_SET_VERSION, type SetupStatusDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { remindersOf } from '../../src/home/reminders.js';
import { at } from '../content/world.js';

const NOW = Date.parse('2026-10-25T10:00:00Z');
const STAMP = { updatedBy: 'system:ops', updatedAt: at('2026-10-17T10:00:00Z') };
const CHECKED = '2026-10-25T09:00:00.000Z';

describe('remindersOf: the installation', () => {
    it('happyPath_anUpdateOfAnyTargetIsRemindedWithItsStep', () => {
        const install = {
            server: { state: 'installed', checkedAt: CHECKED },
            site: { state: 'updateAvailable', release: '1.0.0+abc1234', checkedAt: CHECKED },
        } as const;
        expect(remindersOf({ install, ...STAMP }, NOW)).toEqual([{ kind: 'installUpdate', step: 'site' }]);
        const server = { server: { state: 'updateAvailable', checkedAt: CHECKED } } as const;
        expect(remindersOf({ install: server, ...STAMP }, NOW)).toEqual([{ kind: 'installUpdate', step: 'deploy' }]);
    });

    it('badPath_aStoppedInstallationComesBeforeAnUpdateAndNothingInPlaceRemindsNothing', () => {
        const install = {
            server: { state: 'updateAvailable', checkedAt: CHECKED },
            pipeline: { state: 'failed', checkedAt: CHECKED, detail: 'apiError.unavailable' },
        } as const;
        expect(remindersOf({ install, ...STAMP }, NOW)).toEqual([{ kind: 'installFailed', step: 'pipeline' }]);
        const inPlace = { server: { state: 'installed', checkedAt: CHECKED }, site: { state: 'working', checkedAt: CHECKED } } as const;
        expect(remindersOf({ install: inPlace, ...STAMP }, NOW)).toEqual([]);
        expect(remindersOf({ ...STAMP }, NOW)).toEqual([]);
    });

    it('happyPath_anInstalledRecordOfAnOlderBuildIsAnUpdateForThisAdmin', () => {
        // Finding 39 of 2026-11-01: the admin 1.0.0+9e2e6b5 recorded its server installed; this admin is a newer build of 1.0.0.
        const install = { server: { state: 'installed', release: '1.0.0+9e2e6b5', checkedAt: CHECKED } } as const;
        const bundle = { release: '1.0.0+457201e', time: 1_761_990_000 };

        expect(remindersOf({ install, ...STAMP }, NOW, bundle)).toEqual([{ kind: 'installUpdate', step: 'deploy' }]);
        expect(remindersOf({ install, ...STAMP }, NOW)).toEqual([]);
    });

    it('badPath_aRecordOfANewerBuildOrOfThisVeryReleaseRemindsNothing', () => {
        const bundle = { release: '1.0.0+457201e', time: 1_761_990_000 };
        const install = {
            server: { state: 'installed', release: '1.0.0+fffffff', releaseTime: 1_762_000_000, checkedAt: CHECKED },
            site: { state: 'updateAvailable', release: '1.0.0+457201e', checkedAt: CHECKED },
        } as const;

        expect(remindersOf({ install, ...STAMP }, NOW, bundle)).toEqual([]);
    });

    it('happyPath_aProjectPreparedBeforeProvisionChangedIsAnUpdate @S-A04-HAPPY-UPDATE-PROVISION', () => {
        // Finding 65 of 2026-11-02: everything installed, but M7 changed two Provision items after the project was prepared.
        const install = { server: { state: 'installed', checkedAt: CHECKED } } as const;
        const provision: NonNullable<SetupStatusDoc['provision']> = { state: 'ok', items: [{ id: 'apis', state: 'ok' }] };

        expect(remindersOf({ install, provision, ...STAMP }, NOW)).toEqual([{ kind: 'installUpdate', step: 'deploy' }]);
        expect(remindersOf({ install, provision: { ...provision, setVersion: PROVISION_SET_VERSION }, ...STAMP }, NOW)).toEqual([]);
        expect(remindersOf({ provision, ...STAMP }, NOW)).toEqual([]);
        expect(remindersOf({ install, provision: { state: 'missing' }, ...STAMP }, NOW)).toEqual([]);
    });
});
