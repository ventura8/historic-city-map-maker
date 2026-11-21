/**
 * When Setup is done (`docs/research/M6-interfaces.md` §4.1; findings 16 and 24): USGS ok, postponed or waiting for the
 * approval of a saved token; the installer's targets only once recorded.
 */
import { describe, expect, it } from 'vitest';

import { recordCloudRequestSchema, setupStatusViewSchema } from '../../src/api/setup.js';
import { USGS_ACCESS_PENDING, setupDone, usgsReadiness, type SetupDoneInput } from '../../src/api/setup-done.js';
import { setupStatusDocSchema } from '../../src/schemas/firestore-ops.js';

const OK = { state: 'ok' } as const;
const DONE: SetupDoneInput = { billing: OK, provision: OK, mapbox: OK, usgs: OK };
const AT = '2026-10-25T16:00:00.000Z';

describe('usgsReadiness', () => {
    it('happyPath_okPostponedAndWaitingForApproval', () => {
        expect(usgsReadiness(OK)).toBe('ok');
        expect(usgsReadiness({ state: 'missing', postponedAt: AT })).toBe('postponed');
        expect(usgsReadiness({ state: 'invalid', detail: 'apiError.usgs.credentials', postponedAt: AT })).toBe('postponed');
        expect(usgsReadiness({ state: 'pending', detail: USGS_ACCESS_PENDING })).toBe('approvalPending');
    });

    it('badPath_neverCheckedRefusedOrUnreachableIsStillToDo', () => {
        expect(usgsReadiness(undefined)).toBe('toDo');
        expect(usgsReadiness({ state: 'missing' })).toBe('toDo');
        expect(usgsReadiness({ state: 'invalid', detail: 'apiError.usgs.credentials' })).toBe('toDo');
        expect(usgsReadiness({ state: 'pending' })).toBe('toDo');
        expect(usgsReadiness({ state: 'unavailable', detail: 'apiError.usgs.maintenance' })).toBe('toDo');
    });
});

describe('setupDone', () => {
    it('happyPath_theThreeAreasAndUsgsOkPostponedOrPending', () => {
        expect(setupDone(DONE)).toBe(true);
        expect(setupDone({ ...DONE, usgs: { state: 'missing', postponedAt: AT } })).toBe(true);
        expect(setupDone({ ...DONE, usgs: { state: 'pending', detail: USGS_ACCESS_PENDING } })).toBe(true);
    });

    it('happyPath_theInstallerTargetsCountOnceRecorded', () => {
        const installed = { server: { state: 'installed' }, site: { state: 'updateAvailable' } };
        expect(setupDone({ ...DONE, install: installed })).toBe(true);
        expect(setupDone({ ...DONE, install: { ...installed, site: { state: 'newerInstalled' } } })).toBe(true);
    });

    it('happyPath_anUpdateUnderWayOrStoppedKeepsSetupDoneWhileItsReleaseServes', () => {
        // Finding 5 of the M6 review: Update the map runs 15 to 85 minutes, and the installed release serves meanwhile.
        const site = { state: 'installed' };
        for (const state of ['queued', 'working', 'retrying', 'failed', 'unavailable']) {
            expect(setupDone({ ...DONE, install: { server: { state, release: '0.9.0+0000000' }, site } })).toBe(true);
        }
    });

    it('badPath_anyRequiredAreaNotOkHoldsItBack', () => {
        expect(setupDone({})).toBe(false);
        expect(setupDone({ ...DONE, billing: { state: 'pending' } })).toBe(false);
        expect(setupDone({ ...DONE, mapbox: undefined })).toBe(false);
        expect(setupDone({ ...DONE, usgs: { state: 'missing' } })).toBe(false);
    });

    it('badPath_aSiteNotPublishedOrAServerFailedHoldsItBack', () => {
        expect(setupDone({ ...DONE, install: { server: { state: 'installed' } } })).toBe(false);
        expect(setupDone({ ...DONE, install: { server: { state: 'failed' }, site: { state: 'installed' } } })).toBe(false);
        expect(setupDone({ ...DONE, install: { server: { state: 'installed' }, site: { state: 'notInstalled' } } })).toBe(false);
    });
});

describe('the M6 setup-ux fields', () => {
    it('happyPath_storedAndViewedAndRecorded', () => {
        const stamp = { seconds: 1_760_000_000, nanoseconds: 0 };
        expect(
            setupStatusDocSchema.safeParse({
                billing: { state: 'ok', trialSince: stamp, trialPaidAt: stamp },
                usgs: { state: 'missing', postponedAt: stamp, pendingSince: stamp },
                updatedBy: 'owner-uid',
                updatedAt: stamp,
            }).success,
        ).toBe(true);
        const area = { state: 'missing', checkedAt: null };
        const view = {
            billing: { ...area, trialSince: AT },
            provision: { ...area, items: [] },
            mapbox: area,
            usgs: { ...area, postponedAt: AT, pendingSince: AT },
            analytics: area,
            crash: area,
            secretsRev: 0,
            ready: false,
            generatedAt: AT,
        };
        expect(setupStatusViewSchema.safeParse(view).success).toBe(true);
        expect(recordCloudRequestSchema.safeParse({ postponed: { usgs: false } }).success).toBe(true);
        expect(recordCloudRequestSchema.safeParse({ trial: { since: AT } }).success).toBe(true);
        expect(recordCloudRequestSchema.safeParse({ trial: { paid: true } }).success).toBe(true);
    });

    it('badPath_anUnknownStepOrAMalformedTrialIsRefused', () => {
        expect(recordCloudRequestSchema.safeParse({ postponed: { mapbox: true } }).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({ trial: { since: 'yesterday' } }).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({ trial: { paid: false } }).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({}).success).toBe(false);
    });
});
