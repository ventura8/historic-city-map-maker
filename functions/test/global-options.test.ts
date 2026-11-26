import { CALLABLES, type CallableName } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GLOBAL_OPTIONS, RUNTIME_ACCOUNTS, runAs, serviceAccountEmail } from '../src/global-options.js';

/** The project `firebase emulators:exec --project demo-hcm` sets for every test, as firebase-tools does for discovery. */
const PROJECT = { GCLOUD_PROJECT: 'demo-hcm' };

describe('GLOBAL_OPTIONS', () => {
    it('happyPath_everythingRunsInUsCentral1WithAnInstanceCapAndTheLeastPrivilegedAccount', () => {
        expect(GLOBAL_OPTIONS).toEqual({
            region: 'us-central1',
            maxInstances: 5,
            concurrency: 80,
            serviceAccount: 'fn-events@demo-hcm.iam.gserviceaccount.com',
        });
    });
});

describe('runAs', () => {
    it('happyPath_callablesRunAsFnAdminInTheDeployingProject', () => {
        expect(runAs('admin.claim', PROJECT)).toEqual({ serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com' });
        expect((Object.keys(CALLABLES) as CallableName[]).filter((name) => RUNTIME_ACCOUNTS[name] !== 'fn-admin')).toEqual([]);
    });

    it('happyPath_triggersRunAsFnEvents', () => {
        expect(runAs('photos.onUpload', PROJECT)).toEqual({ serviceAccount: 'fn-events@demo-hcm.iam.gserviceaccount.com' });
        expect(runAs('history.onCityWrite', PROJECT)).toEqual({ serviceAccount: 'fn-events@demo-hcm.iam.gserviceaccount.com' });
    });

    it('happyPath_theProjectComesFromGoogleCloudProjectWhenFirebaseToolsDidNotSetGcloudProject', () => {
        expect(runAs('ops.tick', { GOOGLE_CLOUD_PROJECT: 'bucurestiul-disparut' })).toEqual({
            serviceAccount: 'fn-admin@bucurestiul-disparut.iam.gserviceaccount.com',
        });
        expect(serviceAccountEmail('fn-crash', { GCLOUD_PROJECT: 'demo-hcm', GOOGLE_CLOUD_PROJECT: 'other-project' })).toBe(
            'fn-crash@demo-hcm.iam.gserviceaccount.com',
        );
    });

    it('badPath_withoutAProjectRunAsRefusesInsteadOfWritingTheShorthand @S-A55-BAD-NO-PROJECT', () => {
        // firebase-tools 15.33.0 copies a shorthand `fn-admin@` into the Scheduler job, which Google refuses (finding 11).
        expect(() => runAs('ops.tick', {})).toThrow(/neither GCLOUD_PROJECT nor GOOGLE_CLOUD_PROJECT/);
        expect(() => serviceAccountEmail('fn-events', { GCLOUD_PROJECT: '' })).toThrow(/GOOGLE_CLOUD_PROJECT/);
        expect(() => serviceAccountEmail('fn-events', { GCLOUD_PROJECT: 'Not A Project' })).toThrow(/GCLOUD_PROJECT/);
        const names = Object.keys(RUNTIME_ACCOUNTS) as (keyof typeof RUNTIME_ACCOUNTS)[];
        expect(names.map((name) => runAs(name, PROJECT).serviceAccount).filter((account) => account.endsWith('@'))).toEqual([]);
    });

    it('badPath_thePublicEndpointRunsAsTheAccountWithNoRole', () => {
        // Anyone on the internet calls telemetry.reportError: its account holds no role (DECISIONS-for-review.md §42f).
        expect(runAs('telemetry.reportError', PROJECT)).toEqual({ serviceAccount: 'fn-crash@demo-hcm.iam.gserviceaccount.com' });
        expect(Object.entries(RUNTIME_ACCOUNTS).filter(([, account]) => account === 'fn-crash')).toEqual([
            ['telemetry.reportError', 'fn-crash'],
        ]);
    });

    it('badPath_theSchedulerNeverRunsAsTheTriggerAccount', () => {
        // ops.tick retires Mapbox tokens and deletes stale accounts: fn-admin@ only (DECISIONS-for-review.md §19b).
        expect(runAs('ops.tick', PROJECT)).toEqual({ serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com' });
        expect(runAs('ops.onBudget', PROJECT)).toEqual({ serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com' });
    });
});
