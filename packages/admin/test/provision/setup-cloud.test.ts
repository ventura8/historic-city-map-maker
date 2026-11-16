import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import { createSetupCloud, type SetupCloudAdapter } from '../../src/provision/setup-cloud.js';
import type { SetupCloud } from '../../src/setup/ports.js';
import { BILLING_ACCOUNT, OWNER_EMAIL, PROJECT, provisionWorld, WEB } from './world.js';

/**
 * The Setup Assistant's `SetupCloud` port over the clients and the provisioner (docs/research/M2b-interfaces.md §3.3
 * b–d, g): billing (S-A04-HAPPY, S-A04-BAD-SEVERAL-ACCOUNTS, S-A04-BAD-BILLING-QUOTA), provisioning, the deployment
 * (S-A26-HAPPY, S-A26-BAD-PARTIAL-DEPLOY), the GA4 stream setting (S-A22-HAPPY-STREAM-SETTING, S-A22-BAD-NO-STREAM)
 * and the crash e-mail switch (S-A22-HAPPY-CRASH-ALERTS).
 */

const ACCESS = { token: GOOGLE_TOKENS.owner, scopes: [], expiresAt: 0 };

function cloudOf(world: ReturnType<typeof provisionWorld>): SetupCloudAdapter {
    return createSetupCloud({
        fetch: world.fakes.fetch,
        sleep: () => Promise.resolve(),
        log: world.log,
        project: PROJECT,
        web: WEB,
        ownerEmail: () => OWNER_EMAIL,
    });
}

describe('createSetupCloud', () => {
    it('happyPath_itIsTheSetupAssistantsCloudPort', () => {
        const cloud: SetupCloud = cloudOf(provisionWorld());

        expect(Object.keys(cloud).toSorted((left, right) => left.localeCompare(right))).toEqual(
            [
                'createMeasurementReports',
                'deployment',
                'disablePageChanges',
                'disabledApis',
                'doctor',
                'enableApis',
                'ensureBudget',
                'linkBilling',
                'observeBilling',
                'provision',
                'setCrashAlerts',
            ].toSorted((left, right) => left.localeCompare(right)),
        );
    });

    it('happyPath_billingIsLinkedAndTheBudgetCreatedOnce', async () => {
        const world = provisionWorld({ billing: false });
        const cloud = cloudOf(world);

        const before = await cloud.observeBilling(ACCESS);
        await cloud.linkBilling(ACCESS, BILLING_ACCOUNT);
        const after = await cloud.observeBilling(ACCESS);
        const first = await cloud.ensureBudget(ACCESS, { accountName: BILLING_ACCOUNT, amount: 5, currency: 'USD' });
        const second = await cloud.ensureBudget(ACCESS, { accountName: BILLING_ACCOUNT, amount: 5, currency: 'USD' });

        expect(before).toEqual({
            linkedAccount: null,
            accounts: [{ name: BILLING_ACCOUNT, displayName: 'My Billing Account', currency: 'USD' }],
        });
        expect(after.linkedAccount).toBe(BILLING_ACCOUNT);
        expect(second).toEqual(first);
        expect(world.fakes.callsTo('billing-budgets.create')).toHaveLength(1);
        expect(world.fakes.callsTo('billing-budgets.patch')).toEqual([]);
    });

    it('badPath_severalAccountsAreAllOfferedAndAQuotaRefusalIsAGoogleFailure', async () => {
        const world = provisionWorld({ billing: false });
        world.fakes.scenario('cloud-billing.severalAccounts');
        world.fakes.scenario('cloud-billing.quotaExceeded');
        const cloud = cloudOf(world);

        const observed = await cloud.observeBilling(ACCESS);
        const refused = await cloud.linkBilling(ACCESS, BILLING_ACCOUNT).catch((error: unknown) => error);

        expect(observed.accounts.map((account) => account.currency)).toEqual(['USD', 'EUR']);
        expect(refused).toBeInstanceOf(GoogleApiError);
        expect(refused).toMatchObject({ kind: 'invalid', reason: 'QUOTA_EXCEEDED', role: 'roles/billing.user' });
    });

    it('happyPath_theApisAreCheckedAndEnabled', async () => {
        const world = provisionWorld();
        const cloud = cloudOf(world);
        const wanted = ['cloudbilling.googleapis.com', 'serviceusage.googleapis.com'];

        const disabled = await cloud.disabledApis(ACCESS, wanted);
        await cloud.enableApis(ACCESS, disabled);

        expect(disabled).toEqual(['cloudbilling.googleapis.com']);
        await expect(cloud.disabledApis(ACCESS, wanted)).resolves.toEqual([]);
    });

    it('happyPath_provisionAndDoctorReportEachItem', async () => {
        const world = provisionWorld();
        const cloud = cloudOf(world);
        const heard: string[] = [];

        const provisioned = await cloud.provision(ACCESS, ['apis', 'secrets'], (item) => heard.push(item.id));
        const doctor = await cloud.doctor(ACCESS, null, () => undefined);

        expect(provisioned).toEqual([
            { id: 'apis', state: 'ok' },
            { id: 'secrets', state: 'ok' },
        ]);
        expect(heard).toEqual(['apis', 'secrets']);
        // M6 (CR-M6-2): the pipeline's repository is the 16th item; §210 the admin's own site the 17th.
        expect(doctor).toHaveLength(17);
    });

    it('happyPath_theDeploymentIsCountedAgainstTheRegistry', async () => {
        const world = provisionWorld();
        const cloud = cloudOf(world);

        const nothing = await cloud.deployment(ACCESS).catch((error: unknown) => error);
        world.fakes.scenario('cloud-functions.partial');
        const partial = await cloud.deployment(ACCESS);
        world.fakes.scenario('cloud-functions.failed');
        const failed = await cloud.deployment(ACCESS);
        world.fakes.scenario('cloud-functions.deployed');
        const deployed = await cloud.deployment(ACCESS);

        expect(nothing).toMatchObject({ kind: 'forbidden', api: 'cloudfunctions.googleapis.com' });
        // The registry's 104 functions (M4: orders' 3, assists' and notifications' 7; M5: the cities' 4, the export's 3; M6:
        // the events probe; M7: the local worker's 5 and imagery.runOn; finding 67: worker.pair, pairCode and revoke;
        // finding 72: worker.image; finding 73: worker.starter; imagery.locateAgain; M12: imagery.previewUrl;
        // M13: the roles' and review's 7; M16: imagery.recalibrate; M17: the stories' 2; M20: the local archive's 4 (with worker.archiveCopy); imagery.deleteVersion;
        // the tab icon's cities.setIcon;
        // M20 §19.10: the tile wizard's imagery.saveLayout and imagery.acceptLayout; the owner's not-useful mark imagery.markScene; household computers' worker.manage; Pause's imagery.pause); the fake deploys a third of them.
        expect(partial).toEqual({ ready: 34, total: 104, failed: [] });
        expect(failed).toEqual({ ready: 103, total: 104, failed: ['admin-session'] });
        expect(deployed).toEqual({ ready: 104, total: 104, failed: [] });
    });

    it('happyPath_theStreamsHistoryPageViewsAreTurnedOff', async () => {
        const world = provisionWorld();
        world.fakes.scenario('firebase-management.analyticsLinked');

        const result = await cloudOf(world).disablePageChanges(ACCESS);

        expect(result).toEqual({ pageChangesEnabled: false });
        expect(world.fakes.callsTo('analytics-admin.enhancedMeasurementSettings.patch')[0]?.url).toContain('updateMask=pageChangesEnabled');
    });

    it('happyPath_theMeasurementReportsAreCreatedOnTheStreamsProperty_badPath_anUnknownIdFindsNone', async () => {
        // §76f: the lazy chunk, over the owner's token.
        const world = provisionWorld();
        world.fakes.scenario('firebase-management.analyticsLinked');
        const cloud = cloudOf(world);

        await expect(cloud.createMeasurementReports(ACCESS, 'G-E2E0000000')).resolves.toEqual({ created: 26, skipped: 0 });
        await expect(cloud.createMeasurementReports(ACCESS, 'G-SOMEONE0')).resolves.toBeNull();
    });

    it('badPath_withoutAStreamThereIsNothingToTurnOff', async () => {
        const failure = await cloudOf(provisionWorld())
            .disablePageChanges(ACCESS)
            .catch((error: unknown) => error);

        expect(failure).toMatchObject({ kind: 'notFound', operation: 'firebase-management.getAnalyticsDetails' });
    });

    it('happyPath_theCrashEmailsAreSwitchedOffAndOn', async () => {
        const world = provisionWorld();
        const cloud = cloudOf(world);
        const missing = await cloud.setCrashAlerts(ACCESS, false).catch((error: unknown) => error);
        await cloud.provision(ACCESS, ['crash-alerts'], () => undefined);

        const off = await cloud.setCrashAlerts(ACCESS, false);
        const on = await cloud.setCrashAlerts(ACCESS, true);

        expect(missing).toMatchObject({ kind: 'notFound' });
        expect(off).toEqual({ enabled: false });
        expect(on).toEqual({ enabled: true });
    });
});
