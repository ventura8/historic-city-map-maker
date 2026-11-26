/**
 * The fake Google APIs of `createUpstreamFakes()` (docs/research/M2-interfaces.md §7): what the owner claim, the
 * billing and provisioning steps, the analytics card, the crash panel and the pipeline's executions see, from a fresh
 * Spark project to a provisioned one.
 */
import { createUpstreamFakes, GOOGLE_TOKENS, upstreamHosts, type UpstreamFakes } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

const P = 'https://cloudresourcemanager.googleapis.com/v3/projects/demo-hcm';

async function call(
    fakes: UpstreamFakes,
    method: string,
    url: string,
    body?: unknown,
    token: string | null = GOOGLE_TOKENS.owner,
): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
    const response = await fakes.fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) };
}

describe('Google identity: tokeninfo and Resource Manager', () => {
    it('happyPath_theOwnerTokenNamesTheOwnerAndProvesOwnership', async () => {
        const fakes = createUpstreamFakes();

        const info = await call(
            fakes,
            'GET',
            `https://oauth2.googleapis.com/tokeninfo?access_token=${GOOGLE_TOKENS.owner}`,
            undefined,
            null,
        );
        const tested = await call(fakes, 'POST', `${P}:testIamPermissions`, { permissions: ['resourcemanager.projects.setIamPolicy'] });

        expect(info).toMatchObject({
            status: 200,
            body: { email: 'owner@e2e.test', aud: '123456789012-e2eclient.apps.googleusercontent.com', email_verified: 'true' },
        });
        expect((info.body as { scope: string }).scope).toContain('cloud-platform.read-only');
        expect(tested).toEqual({ status: 200, body: { permissions: ['resourcemanager.projects.setIamPolicy'] } });
    });

    it('badPath_anEditorHoldsNoOwnerPermissionAndAStrangerIsRefused', async () => {
        const fakes = createUpstreamFakes();
        const asked = { permissions: ['resourcemanager.projects.setIamPolicy', 'resourcemanager.projects.get'] };

        expect(await call(fakes, 'POST', `${P}:testIamPermissions`, asked, GOOGLE_TOKENS.editor)).toEqual({
            status: 200,
            body: { permissions: ['resourcemanager.projects.get'] },
        });
        expect(
            await call(
                fakes,
                'POST',
                `${P}:testIamPermissions`,
                { permissions: ['resourcemanager.projects.setIamPolicy'] },
                GOOGLE_TOKENS.editor,
            ),
        ).toEqual({ status: 200, body: {} });
        expect((await call(fakes, 'POST', `${P}:testIamPermissions`, asked, GOOGLE_TOKENS.stranger)).status).toBe(403);
        expect((await call(fakes, 'POST', `${P}:testIamPermissions`, asked, GOOGLE_TOKENS.expired)).status).toBe(401);
    });

    it('happyPath_tokeninfoReadsTheTokenFromTheAuthorizationHeaderToo', async () => {
        const fakes = createUpstreamFakes();

        const info = await call(fakes, 'POST', 'https://oauth2.googleapis.com/tokeninfo', undefined, GOOGLE_TOKENS.owner);
        const form = await fakes.fetch('https://oauth2.googleapis.com/tokeninfo', {
            method: 'POST',
            body: new URLSearchParams({ access_token: GOOGLE_TOKENS.editor }),
        });

        expect(info).toMatchObject({ status: 200, body: { email: 'owner@e2e.test' } });
        await expect(form.json()).resolves.toMatchObject({ email: 'editor@e2e.test' });
        expect((await call(fakes, 'GET', 'https://oauth2.googleapis.com/tokeninfo', undefined, null)).status).toBe(400);
    });

    it('badPath_foreignAndExpiredTokens', async () => {
        const fakes = createUpstreamFakes();
        const info = (token: string) =>
            call(fakes, 'POST', `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`, undefined, null);

        expect(await info(GOOGLE_TOKENS.otherClient)).toMatchObject({ body: { aud: '210987654321-elsewhere.apps.googleusercontent.com' } });
        expect(((await info(GOOGLE_TOKENS.noScope)).body as { scope: string }).scope).not.toContain('cloud-platform');
        expect(await info(GOOGLE_TOKENS.expired)).toEqual({
            status: 400,
            body: { error: 'invalid_token', error_description: 'Invalid Value' },
        });
        fakes.scenario('google-oauth.ownerTokenExpired');
        expect((await info(GOOGLE_TOKENS.owner)).status).toBe(400);
    });

    it('happyPath_aPolicyWriteNeedsTheCurrentEtag', async () => {
        const fakes = createUpstreamFakes();
        const policy = (await call(fakes, 'POST', `${P}:getIamPolicy`, {})).body as { etag: string; bindings: unknown[] };
        const binding = { role: 'roles/firebase.viewer', members: ['serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com'] };

        const written = await call(fakes, 'POST', `${P}:setIamPolicy`, { policy: { ...policy, bindings: [...policy.bindings, binding] } });
        const stale = await call(fakes, 'POST', `${P}:setIamPolicy`, { policy });

        expect(written).toMatchObject({ status: 200, body: { etag: 'BwXe2e0002A=' } });
        expect(stale).toMatchObject({ status: 409, body: { error: { status: 'ABORTED' } } });
        expect((await call(fakes, 'GET', P)).body).toMatchObject({ projectId: 'demo-hcm', name: 'projects/123456789012' });
    });

    it('badPath_domainRestrictedSharingRefusesAnOutsideMember', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('resource-manager.domainRestricted');

        const refused = await call(fakes, 'POST', `${P}:setIamPolicy`, {
            policy: { bindings: [{ role: 'roles/viewer', members: ['user:someone@elsewhere.test'] }] },
        });
        const invalid = await call(fakes, 'POST', `${P}:setIamPolicy`, { policy: 'none' });

        expect(refused).toMatchObject({ status: 400, body: { error: { status: 'FAILED_PRECONDITION' } } });
        expect(JSON.stringify(refused.body)).toContain('user:someone@elsewhere.test');
        expect(invalid.status).toBe(400);
    });

    it('happyPath_aNewProjectHoldsEditorForBothDefaultAccountsAsGoogleGrantsIt', async () => {
        const fakes = createUpstreamFakes();

        const policy = (await call(fakes, 'POST', `${P}:getIamPolicy`, {})).body as { bindings: { role: string; members: string[] }[] };

        expect(policy.bindings.find((binding) => binding.role === 'roles/editor')?.members).toEqual([
            'serviceAccount:123456789012-compute@developer.gserviceaccount.com',
            'serviceAccount:demo-hcm@appspot.gserviceaccount.com',
        ]);
    });

    it('badPath_aDenyPolicyKeepsTheAppEngineEditorAndRefusesOnlyAWriteThatDropsIt', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('resource-manager.appEngineEditorLocked');
        const read = async (): Promise<{ etag: string; bindings: { role: string; members: string[] }[] }> =>
            (await call(fakes, 'POST', `${P}:getIamPolicy`, {})).body as { etag: string; bindings: { role: string; members: string[] }[] };
        const policy = await read();
        const added = { role: 'roles/firebase.viewer', members: ['serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com'] };
        const dropped = policy.bindings.map((binding) =>
            binding.role === 'roles/editor'
                ? { ...binding, members: binding.members.filter((member) => !member.includes('appspot')) }
                : binding,
        );

        const refused = await call(fakes, 'POST', `${P}:setIamPolicy`, { policy: { ...policy, bindings: dropped } });
        const kept = await call(fakes, 'POST', `${P}:setIamPolicy`, { policy: { ...policy, bindings: [...policy.bindings, added] } });

        expect(refused).toMatchObject({ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } });
        expect(JSON.stringify(refused.body)).toContain('resourcemanager.projects.setIamPolicy');
        expect(kept.status).toBe(200);
        // A policy that no longer holds the binding (someone removed it before the deny policy) is written freely.
        fakes.state.resourceManager.policies.set('demo-hcm', { version: 1, etag: (await read()).etag, bindings: dropped });
        expect((await call(fakes, 'POST', `${P}:setIamPolicy`, { policy: { bindings: [added] } })).status).toBe(200);
    });
});

describe('Cloud Billing, Budgets and Service Usage', () => {
    const BILLING = 'https://cloudbilling.googleapis.com/v1';
    const SERVICES = 'https://serviceusage.googleapis.com/v1/projects/demo-hcm/services';

    it('badPath_aFreshProjectHasAnAccountButNoBillingAndCannotEnableBilledApis', async () => {
        const fakes = createUpstreamFakes();

        expect(await call(fakes, 'GET', `${BILLING}/projects/demo-hcm/billingInfo`)).toEqual({
            status: 200,
            body: { name: 'projects/demo-hcm/billingInfo', projectId: 'demo-hcm' },
        });
        const refused = await call(fakes, 'POST', `${SERVICES}:batchEnable`, { serviceIds: ['iam.googleapis.com', 'run.googleapis.com'] });

        expect(refused).toMatchObject({ status: 400, body: { error: { status: 'FAILED_PRECONDITION' } } });
        expect(JSON.stringify(refused.body)).toContain('UREQ_PROJECT_BILLING_NOT_FOUND');
        expect(await call(fakes, 'GET', `${SERVICES}/run.googleapis.com`)).toMatchObject({ body: { state: 'DISABLED' } });
    });

    it('happyPath_linkingTheAccountEnablesBillingThenTheApisAndTheBudget', async () => {
        const fakes = createUpstreamFakes();
        const accounts = (await call(fakes, 'GET', `${BILLING}/billingAccounts`)).body as { billingAccounts: { name: string }[] };
        const account = String(accounts.billingAccounts[0]?.name);

        const linked = await call(fakes, 'PUT', `${BILLING}/projects/demo-hcm/billingInfo`, { billingAccountName: account });
        const enabled = (await call(fakes, 'POST', `${SERVICES}:batchEnable`, { serviceIds: ['run.googleapis.com'] })).body as {
            name: string;
            done: boolean;
        };
        const operation = await call(fakes, 'GET', `https://serviceusage.googleapis.com/v1/${enabled.name}`);
        const budget = await call(fakes, 'POST', `https://billingbudgets.googleapis.com/v1/${account}/budgets`, {
            displayName: 'Historic City Map $5',
        });
        const budgets = await call(fakes, 'GET', `https://billingbudgets.googleapis.com/v1/${account}/budgets`);

        expect(linked).toMatchObject({ status: 200, body: { billingEnabled: true, billingAccountName: account } });
        expect(enabled.done).toBe(true);
        expect(operation).toMatchObject({
            status: 200,
            body: { done: true, response: { services: [{ config: { name: 'run.googleapis.com' }, state: 'ENABLED' }] } },
        });
        expect(budget).toMatchObject({
            status: 200,
            body: { name: `${account}/budgets/0e2e0000-0000-4000-8000-000000000001`, displayName: 'Historic City Map $5' },
        });
        expect((budgets.body as { budgets: unknown[] }).budgets).toHaveLength(1);
        expect((await call(fakes, 'GET', SERVICES)).body).toMatchObject({
            services: expect.arrayContaining([expect.objectContaining({ state: 'ENABLED' })]) as unknown,
        });
    });

    it('happyPath_theScenarioMovesBillingFromDisabledToEnabled', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('cloud-billing.noAccount');
        expect(await call(fakes, 'GET', `${BILLING}/billingAccounts`)).toEqual({ status: 200, body: {} });

        fakes.scenario('cloud-billing.enabled');

        expect(await call(fakes, 'GET', `${BILLING}/projects/demo-hcm/billingInfo`)).toMatchObject({ body: { billingEnabled: true } });
        fakes.scenario('cloud-billing.disabled');
        expect(await call(fakes, 'GET', `${BILLING}/projects/demo-hcm/billingInfo`)).toMatchObject({ body: { projectId: 'demo-hcm' } });
    });

    it('badPath_aCallerWhoIsNotABillingAccountUserCannotLink', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('cloud-billing.linkForbidden');

        expect(
            (
                await call(fakes, 'PUT', `${BILLING}/projects/demo-hcm/billingInfo`, {
                    billingAccountName: 'billingAccounts/0E2E00-0E2E00-0E2E01',
                })
            ).status,
        ).toBe(403);
        expect((await call(fakes, 'POST', 'https://billingbudgets.googleapis.com/v1/billingAccounts/unknown/budgets', {})).status).toBe(
            403,
        );
    });

    it('badPath_everyGoogleApiRefusesARequestWithoutABearerToken', async () => {
        const fakes = createUpstreamFakes();

        const refused = await call(fakes, 'GET', `${BILLING}/billingAccounts`, undefined, null);

        expect(refused).toMatchObject({ status: 401, body: { error: { status: 'UNAUTHENTICATED' } } });
    });
});

describe('IAM', () => {
    const IAM = 'https://iam.googleapis.com/v1/projects/demo-hcm';
    const COMPUTE = '123456789012-compute@developer.gserviceaccount.com';

    it('happyPath_aServiceAccountIsCreatedOnceAndItsPolicySet', async () => {
        const fakes = createUpstreamFakes();
        const created = await call(fakes, 'POST', `${IAM}/serviceAccounts`, {
            accountId: 'fn-admin',
            serviceAccount: { displayName: 'Functions: admin' },
        });
        const again = await call(fakes, 'POST', `${IAM}/serviceAccounts`, { accountId: 'fn-admin' });
        const email = 'fn-admin@demo-hcm.iam.gserviceaccount.com';
        const policy = { bindings: [{ role: 'roles/iam.workloadIdentityUser', members: ['principalSet://e2e'] }] };

        expect(created).toMatchObject({ status: 200, body: { email, displayName: 'Functions: admin' } });
        expect(again.status).toBe(409);
        expect(await call(fakes, 'POST', `${IAM}/serviceAccounts/${email}:setIamPolicy`, { policy })).toMatchObject({
            status: 200,
            body: policy,
        });
        expect(await call(fakes, 'POST', `${IAM}/serviceAccounts/${email}:getIamPolicy`, {})).toMatchObject({ body: policy });
        expect(await call(fakes, 'GET', `${IAM}/serviceAccounts/${email}`)).toMatchObject({ status: 200, body: { email } });
        // Google's own App Engine (finding 28 of 2026-10-31) and Compute Engine (finding 33) default accounts are listed too.
        expect((await call(fakes, 'GET', `${IAM}/serviceAccounts`)).body).toMatchObject({
            accounts: [{ email }, { email: 'demo-hcm@appspot.gserviceaccount.com' }, { email: COMPUTE }],
        });
    });

    it('happyPath_theAppEngineDefaultAccountIsGooglesOwn_badPath_aProjectWithoutItAnswers404', async () => {
        const fakes = createUpstreamFakes();
        const appEngine = 'demo-hcm@appspot.gserviceaccount.com';
        const user = {
            bindings: [{ role: 'roles/iam.serviceAccountUser', members: ['serviceAccount:x@demo-hcm.iam.gserviceaccount.com'] }],
        };

        expect(await call(fakes, 'GET', `${IAM}/serviceAccounts/${appEngine}`)).toMatchObject({
            status: 200,
            body: { email: appEngine, name: `projects/demo-hcm/serviceAccounts/${appEngine}` },
        });
        expect((await call(fakes, 'POST', `${IAM}/serviceAccounts/${appEngine}:setIamPolicy`, { policy: user })).status).toBe(200);
        fakes.scenario('iam.appEngineActAsMissing');
        expect(await call(fakes, 'POST', `${IAM}/serviceAccounts/${appEngine}:getIamPolicy`, {})).toMatchObject({ body: { bindings: [] } });
        fakes.scenario('iam.noAppEngineAccount');
        expect((await call(fakes, 'GET', `${IAM}/serviceAccounts/${appEngine}`)).status).toBe(404);
        expect((await call(fakes, 'GET', `${IAM}/serviceAccounts`)).body).toMatchObject({ accounts: [{ email: COMPUTE }] });
    });

    it('happyPath_theComputeEngineDefaultAccountIsGooglesOwn_badPath_aProjectWithoutItAnswers404', async () => {
        // Finding 33 of 2026-10-31: the functions' build account, whose own policy says who may act as it.
        const fakes = createUpstreamFakes();
        const user = {
            bindings: [{ role: 'roles/iam.serviceAccountUser', members: ['serviceAccount:x@demo-hcm.iam.gserviceaccount.com'] }],
        };

        expect(await call(fakes, 'GET', `${IAM}/serviceAccounts/${COMPUTE}`)).toMatchObject({
            status: 200,
            body: { email: COMPUTE, name: `projects/demo-hcm/serviceAccounts/${COMPUTE}` },
        });
        expect((await call(fakes, 'POST', `${IAM}/serviceAccounts/${COMPUTE}:setIamPolicy`, { policy: user })).status).toBe(200);
        fakes.scenario('iam.computeActAsMissing');
        expect(await call(fakes, 'POST', `${IAM}/serviceAccounts/${COMPUTE}:getIamPolicy`, {})).toMatchObject({ body: { bindings: [] } });
        fakes.scenario('iam.noComputeAccount');
        expect((await call(fakes, 'GET', `${IAM}/serviceAccounts/${COMPUTE}`)).status).toBe(404);
        expect((await call(fakes, 'GET', `${IAM}/serviceAccounts`)).body).toMatchObject({
            accounts: [{ email: 'demo-hcm@appspot.gserviceaccount.com' }],
        });
    });

    it('badPath_anUnknownAccountOrAnInvalidIdIsRefused', async () => {
        const fakes = createUpstreamFakes();

        expect((await call(fakes, 'GET', `${IAM}/serviceAccounts/nobody@demo-hcm.iam.gserviceaccount.com`)).status).toBe(404);
        expect((await call(fakes, 'POST', `${IAM}/serviceAccounts`, { accountId: 'X' })).status).toBe(400);
    });

    it('happyPath_theWorkloadIdentityPoolAndProviderAreCreatedOnce', async () => {
        const fakes = createUpstreamFakes();
        const pools = `${IAM}/locations/global/workloadIdentityPools`;

        const pool = (await call(fakes, 'POST', `${pools}?workloadIdentityPoolId=github`, { displayName: 'GitHub Actions' })).body as {
            name: string;
        };
        const operation = await call(fakes, 'GET', `https://iam.googleapis.com/v1/${pool.name}`);
        const provider = await call(fakes, 'POST', `${pools}/github/providers?workloadIdentityPoolProviderId=github-actions`, {
            oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
        });

        expect(operation).toMatchObject({ status: 200, body: { done: true } });
        expect(provider.status).toBe(200);
        expect(await call(fakes, 'GET', `${pools}/github`)).toMatchObject({ body: { displayName: 'GitHub Actions', state: 'ACTIVE' } });
        expect(await call(fakes, 'GET', `${pools}/github/providers/github-actions`)).toMatchObject({
            body: { state: 'ACTIVE', oidc: { issuerUri: 'https://token.actions.githubusercontent.com' } },
        });
        expect((await call(fakes, 'POST', `${pools}?workloadIdentityPoolId=github`, {})).status).toBe(409);
        expect((await call(fakes, 'POST', `${pools}/github/providers?workloadIdentityPoolProviderId=github-actions`, {})).status).toBe(409);
        expect((await call(fakes, 'POST', `${pools}/missing/providers?workloadIdentityPoolProviderId=x`, {})).status).toBe(404);
        expect((await call(fakes, 'GET', `${pools}/missing`)).status).toBe(404);
        expect((await call(fakes, 'GET', `${pools}/github/providers/missing`)).status).toBe(404);
    });
});

describe('Firebase Management', () => {
    const FIREBASE = 'https://firebase.googleapis.com/v1beta1/projects/demo-hcm';
    const APP = '1:123456789012:web:0e2e0e2e';

    it('badPath_aFreshProjectHasItsWebAppButNoMeasurementId', async () => {
        const fakes = createUpstreamFakes();

        expect(await call(fakes, 'GET', `${FIREBASE}/webApps`)).toMatchObject({
            status: 200,
            body: { apps: [{ appId: APP, state: 'ACTIVE' }] },
        });
        const config = await call(fakes, 'GET', `${FIREBASE}/webApps/${APP}/config`);
        expect(config.body).not.toHaveProperty('measurementId');
        expect((await call(fakes, 'GET', `${FIREBASE}/analyticsDetails`)).status).toBe(404);
    });

    it('happyPath_addingGoogleAnalyticsGivesTheConfigItsMeasurementId', async () => {
        const fakes = createUpstreamFakes();

        const operation = (await call(fakes, 'POST', `${FIREBASE}:addGoogleAnalytics`, { analyticsAccountId: '300000001' })).body as {
            name: string;
        };

        expect(await call(fakes, 'GET', `https://firebase.googleapis.com/v1beta1/${operation.name}`)).toMatchObject({
            body: { done: true, response: { streamMappings: [{ measurementId: 'G-E2E0000000' }] } },
        });
        expect(await call(fakes, 'GET', `${FIREBASE}/webApps/${APP}/config`)).toMatchObject({
            body: { measurementId: 'G-E2E0000000', projectId: 'demo-hcm' },
        });
        expect(await call(fakes, 'GET', `${FIREBASE}/analyticsDetails`)).toMatchObject({ status: 200 });
        expect((await call(fakes, 'GET', 'https://firebase.googleapis.com/v1beta1/operations/analytics/unknown')).status).toBe(404);
    });

    it('badPath_noWebAppAndAMissingRole', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('firebase-management.noWebApp');

        expect(await call(fakes, 'GET', `${FIREBASE}/webApps`)).toEqual({ status: 200, body: {} });
        expect((await call(fakes, 'GET', `${FIREBASE}/webApps/${APP}/config`)).status).toBe(404);
        fakes.fail('firebase-management', 'forbidden');
        expect(await call(fakes, 'GET', `${FIREBASE}/webApps`)).toMatchObject({
            status: 403,
            body: { error: { status: 'PERMISSION_DENIED' } },
        });
    });

    it('badPath_aDisabledApiNamesItself', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('firebase-management.analyticsLinked');
        fakes.fail('firebase-management', 'apiDisabled');

        const refused = await call(fakes, 'GET', `${FIREBASE}/webApps`);

        expect(refused.status).toBe(403);
        expect(JSON.stringify(refused.body)).toContain('"reason":"SERVICE_DISABLED"');
        expect(JSON.stringify(refused.body)).toContain('"service":"firebase.googleapis.com"');
        fakes.fail('firebase-management', null);
        expect(await call(fakes, 'GET', `${FIREBASE}/webApps/${APP}/config`)).toMatchObject({
            status: 200,
            body: { measurementId: 'G-E2E0000000' },
        });
    });
});

describe('Secret Manager', () => {
    const SECRETS = 'https://secretmanager.googleapis.com/v1/projects/demo-hcm/secrets';
    const encode = (value: string) => Buffer.from(value).toString('base64');

    it('happyPath_aVersionAddedIsTheLatestAndOlderOnesCanBeDestroyed', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('secret-manager.provisioned');

        await call(fakes, 'POST', `${SECRETS}/mapbox-sk-bootstrap:addVersion`, { payload: { data: encode('sk.e2e-old') } });
        const added = await call(fakes, 'POST', `${SECRETS}/mapbox-sk-bootstrap:addVersion`, {
            payload: { data: encode('sk.e2e-bootstrap-all-scopes') },
        });
        const latest = (await call(fakes, 'GET', `${SECRETS}/mapbox-sk-bootstrap/versions/latest:access`)).body as {
            payload: { data: string };
        };
        const destroyed = await call(fakes, 'POST', `${SECRETS}/mapbox-sk-bootstrap/versions/1:destroy`, {});

        expect(added).toMatchObject({
            status: 200,
            body: { name: 'projects/123456789012/secrets/mapbox-sk-bootstrap/versions/2', state: 'ENABLED' },
        });
        expect(Buffer.from(latest.payload.data, 'base64').toString()).toBe('sk.e2e-bootstrap-all-scopes');
        expect(fakes.secretValue('mapbox-sk-bootstrap')).toBe('sk.e2e-bootstrap-all-scopes');
        expect(destroyed).toMatchObject({ body: { state: 'DESTROYED' } });
        expect((await call(fakes, 'GET', `${SECRETS}/mapbox-sk-bootstrap/versions?filter=state:ENABLED`)).body).toMatchObject({
            totalSize: 1,
        });
        expect((await call(fakes, 'GET', `${SECRETS}/mapbox-sk-bootstrap/versions`)).body).toMatchObject({
            totalSize: 2,
            versions: [{ state: 'ENABLED' }, { state: 'DESTROYED' }],
        });
        expect((await call(fakes, 'GET', `${SECRETS}/mapbox-sk-bootstrap/versions/1:access`)).status).toBe(404);
    });

    it('badPath_aMissingSecretOrVersionIs404AndASecondCreateIs409', async () => {
        const fakes = createUpstreamFakes();

        expect((await call(fakes, 'POST', `${SECRETS}/usgs-username:addVersion`, { payload: { data: encode('e2e-ok') } })).status).toBe(
            404,
        );
        expect((await call(fakes, 'POST', `${SECRETS}?secretId=usgs-username`, { replication: { automatic: {} } })).status).toBe(200);
        expect((await call(fakes, 'POST', `${SECRETS}?secretId=usgs-username`, {})).status).toBe(409);
        expect((await call(fakes, 'POST', `${SECRETS}?secretId=bad%20id`, {})).status).toBe(400);
        expect((await call(fakes, 'GET', `${SECRETS}/usgs-username/versions/latest:access`)).status).toBe(404);
        expect((await call(fakes, 'POST', `${SECRETS}/usgs-username:addVersion`, { payload: {} })).status).toBe(400);
        expect((await call(fakes, 'POST', `${SECRETS}/usgs-username/versions/9:disable`, {})).status).toBe(404);
        expect((await call(fakes, 'GET', `${SECRETS}/usgs-username`)).status).toBe(200);
        expect((await call(fakes, 'DELETE', `${SECRETS}/usgs-username`)).status).toBe(200);
        expect((await call(fakes, 'GET', `${SECRETS}/usgs-username`)).status).toBe(404);
        expect(fakes.secretValue('usgs-username')).toBeUndefined();
    });
});

describe('Cloud Run and Cloud Tasks', () => {
    const RUN = 'https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs/hcm-pipeline';
    const QUEUES = 'https://cloudtasks.googleapis.com/v2/projects/demo-hcm/locations/us-central1/queues';

    it('happyPath_anExecutionRunsUntilAScenarioFinishesIt', async () => {
        const fakes = createUpstreamFakes();
        expect((await call(fakes, 'POST', `${RUN}:run`, {})).status).toBe(404);
        fakes.scenario('cloud-run.jobProvisioned');

        const operation = (
            await call(fakes, 'POST', `${RUN}:run`, {
                overrides: { containerOverrides: [{ env: [{ name: 'HCM_JOB_ID', value: 'job-1' }] }] },
            })
        ).body as {
            metadata: { name: string };
        };
        const execution = `https://run.googleapis.com/v2/${operation.metadata.name}`;

        expect(await call(fakes, 'GET', execution)).toMatchObject({
            body: { runningCount: 1, conditions: [{ state: 'CONDITION_PENDING' }] },
        });
        fakes.scenario('cloud-run.executionsSucceed');
        expect(await call(fakes, 'GET', execution)).toMatchObject({ body: { succeededCount: 1 } });
        expect(fakes.snapshot()['cloud-run']).toMatchObject({ jobs: ['demo-hcm/us-central1/hcm-pipeline'] });
        expect(JSON.stringify(fakes.snapshot()['cloud-run'])).toContain('"HCM_JOB_ID":"job-1"');
        expect((await call(fakes, 'GET', RUN)).status).toBe(200);
    });

    it('badPath_aCancelledOrFailedExecution', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('cloud-run.jobProvisioned');
        const first = ((await call(fakes, 'POST', `${RUN}:run`, {})).body as { metadata: { name: string } }).metadata.name;
        const second = ((await call(fakes, 'POST', `${RUN}:run`, {})).body as { metadata: { name: string } }).metadata.name;

        await call(fakes, 'POST', `https://run.googleapis.com/v2/${first}:cancel`, {});
        fakes.scenario('cloud-run.executionsFail');

        expect(await call(fakes, 'GET', `https://run.googleapis.com/v2/${first}`)).toMatchObject({ body: { cancelledCount: 1 } });
        expect(await call(fakes, 'GET', `https://run.googleapis.com/v2/${second}`)).toMatchObject({ body: { failedCount: 1 } });
        expect((await call(fakes, 'GET', `${RUN}/executions/unknown`)).status).toBe(404);
        expect((await call(fakes, 'GET', 'https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs/other')).status).toBe(
            404,
        );
    });

    it('happyPath_aTaskNameDeduplicatesEvenAfterItsTaskIsGone', async () => {
        const fakes = createUpstreamFakes();
        expect((await call(fakes, 'POST', `${QUEUES}/publish-buildManifest/tasks`, { task: {} })).status).toBe(404);
        fakes.scenario('cloud-tasks.queueProvisioned');
        const name = `projects/demo-hcm/locations/us-central1/queues/publish-buildManifest/tasks/bucharest-29`;

        const first = await call(fakes, 'POST', `${QUEUES}/publish-buildManifest/tasks`, {
            task: { name, httpRequest: { url: 'https://e2e.test/fn' } },
        });
        const deleted = await call(fakes, 'DELETE', `https://cloudtasks.googleapis.com/v2/${name}`);
        const again = await call(fakes, 'POST', `${QUEUES}/publish-buildManifest/tasks`, { task: { name } });
        const unnamed = await call(fakes, 'POST', `${QUEUES}/publish-buildManifest/tasks`, { task: {} });

        expect(first).toMatchObject({ status: 200, body: { name, httpRequest: { url: 'https://e2e.test/fn' } } });
        expect([deleted.status, again.status, unnamed.status]).toEqual([200, 409, 200]);
        expect((await call(fakes, 'GET', `${QUEUES}/publish-buildManifest/tasks`)).body).toMatchObject({
            tasks: [{ name: expect.stringMatching(/tasks\/e2e-task-0001$/) as unknown }],
        });
        expect((await call(fakes, 'DELETE', `https://cloudtasks.googleapis.com/v2/${name}`)).status).toBe(404);
    });

    it('happyPath_aQueueIsCreatedOnce', async () => {
        const fakes = createUpstreamFakes();
        const queue = {
            name: 'projects/demo-hcm/locations/us-central1/queues/publish-buildManifest',
            rateLimits: { maxConcurrentDispatches: 1 },
        };

        expect(await call(fakes, 'POST', QUEUES, queue)).toMatchObject({ status: 200, body: { state: 'RUNNING' } });
        expect((await call(fakes, 'POST', QUEUES, queue)).status).toBe(409);
        expect((await call(fakes, 'POST', QUEUES, {})).status).toBe(400);
        expect(await call(fakes, 'GET', `${QUEUES}/publish-buildManifest`)).toMatchObject({
            body: { rateLimits: { maxConcurrentDispatches: 1 } },
        });
    });
});

describe('Cloud Storage, Error Reporting and the presets', () => {
    it('badPath_anOrganizationPolicyRefusesAPublicBucket', async () => {
        const fakes = createUpstreamFakes();
        const buckets = 'https://storage.googleapis.com/storage/v1/b';
        const publicPolicy = { bindings: [{ role: 'roles/storage.objectViewer', members: ['allUsers'] }] };

        expect(
            (await call(fakes, 'POST', `${buckets}?project=demo-hcm`, { name: 'demo-hcm-public', location: 'US-CENTRAL1' })).status,
        ).toBe(200);
        expect((await call(fakes, 'POST', `${buckets}?project=demo-hcm`, { name: 'demo-hcm-public' })).status).toBe(409);
        expect(
            await call(fakes, 'PATCH', `${buckets}/demo-hcm-public`, { cors: [{ origin: ['https://ventura8.github.io'] }] }),
        ).toMatchObject({ body: { cors: [{ origin: ['https://ventura8.github.io'] }] } });
        expect((await call(fakes, 'PUT', `${buckets}/demo-hcm-public/iam`, publicPolicy)).status).toBe(200);
        fakes.scenario('cloud-storage.publicAccessPrevented');
        expect(await call(fakes, 'PUT', `${buckets}/demo-hcm-public/iam`, publicPolicy)).toMatchObject({
            status: 412,
            body: { error: { errors: [{ reason: 'conditionNotMet' }] } },
        });
        expect(JSON.stringify((await call(fakes, 'GET', `${buckets}/demo-hcm-public/iam`)).body)).toContain('allUsers');
        expect((await call(fakes, 'GET', `${buckets}/missing`)).status).toBe(404);
        expect((await call(fakes, 'POST', `${buckets}?project=demo-hcm`, { name: 'X' })).status).toBe(400);
        fakes.scenario('cloud-storage.bucketsProvisioned');
        expect((await call(fakes, 'GET', `${buckets}/demo-hcm.firebasestorage.app`)).status).toBe(200);
    });

    it('happyPath_errorGroupsArePaged', async () => {
        const fakes = createUpstreamFakes();
        const stats = 'https://clouderrorreporting.googleapis.com/v1beta1/projects/demo-hcm/groupStats?timeRange.period=PERIOD_1_DAY';
        expect(await call(fakes, 'GET', stats)).toEqual({ status: 200, body: { timeRangeBegin: '2026-10-11T08:30:00Z' } });
        fakes.scenario('error-reporting.twoGroups');

        const first = await call(fakes, 'GET', `${stats}&pageSize=1`);
        const second = await call(fakes, 'GET', `${stats}&pageSize=1&pageToken=1`);

        expect(first).toMatchObject({ body: { errorGroupStats: [{ group: { groupId: 'CNe2e0group0001' } }], nextPageToken: '1' } });
        expect(second.body).not.toHaveProperty('nextPageToken');
        expect((await call(fakes, 'GET', 'https://clouderrorreporting.googleapis.com/v1beta1/projects/demo-hcm/groupStats')).status).toBe(
            400,
        );
        fakes.fail('error-reporting', 'unavailable');
        expect((await call(fakes, 'GET', stats)).status).toBe(503);
    });

    it('happyPath_googleProvisionedPresetsEveryProvisionedItem', async () => {
        const fakes = createUpstreamFakes();

        fakes.scenario('google.provisioned');

        expect(await call(fakes, 'GET', 'https://cloudbilling.googleapis.com/v1/projects/demo-hcm/billingInfo')).toMatchObject({
            body: { billingEnabled: true },
        });
        expect(
            await call(fakes, 'GET', 'https://serviceusage.googleapis.com/v1/projects/demo-hcm/services/secretmanager.googleapis.com'),
        ).toMatchObject({ body: { state: 'ENABLED' } });
        expect((await call(fakes, 'GET', 'https://secretmanager.googleapis.com/v1/projects/demo-hcm/secrets/mapbox-sk-tiles')).status).toBe(
            200,
        );
        expect(fakes.scenarioNames).toContain('google.provisioned');
    });

    it('badPath_anUnknownScenarioOrFailureModeThrows', () => {
        const fakes = createUpstreamFakes();

        expect(() => {
            fakes.scenario('nothing.here');
        }).toThrow('unknown upstream scenario nothing.here');
        expect(() => {
            fakes.fail('nominatim', 'apiDisabled');
        }).toThrow('nominatim has no failure mode apiDisabled');
    });
});

describe("the scenarios of the Setup Assistant's step specs", () => {
    it('happyPath_theBillingApisCanBeOnWithoutBilling', async () => {
        const fakes = createUpstreamFakes();
        const service = (name: string): string => `https://serviceusage.googleapis.com/v1/projects/demo-hcm/services/${name}`;
        expect(await call(fakes, 'GET', service('cloudbilling.googleapis.com'))).toMatchObject({ body: { state: 'DISABLED' } });

        fakes.scenario('service-usage.billingApisEnabled');

        expect(await call(fakes, 'GET', service('cloudbilling.googleapis.com'))).toMatchObject({ body: { state: 'ENABLED' } });
        expect(await call(fakes, 'GET', service('billingbudgets.googleapis.com'))).toMatchObject({ body: { state: 'ENABLED' } });
        expect(await call(fakes, 'GET', service('cloudfunctions.googleapis.com'))).toMatchObject({ body: { state: 'DISABLED' } });
    });

    it('badPath_aStaleBudgetOfTheAppIsListedOutOfSpec', async () => {
        const fakes = createUpstreamFakes();
        const budgets = 'https://billingbudgets.googleapis.com/v1/billingAccounts/0E2E00-0E2E00-0E2E01/budgets';

        fakes.scenario('billing-budgets.staleBudget');
        const listed = (await call(fakes, 'GET', budgets)).body as { budgets: Record<string, unknown>[] };

        expect(listed.budgets).toHaveLength(1);
        expect(listed.budgets[0]).toMatchObject({
            displayName: 'historic-city-map demo-hcm',
            amount: { specifiedAmount: { currencyCode: 'USD', units: '3' } },
            thresholdRules: [{ thresholdPercent: 1, spendBasis: 'CURRENT_SPEND' }],
        });
    });

    it('happyPath_theAppsBudgetInSpecHasNoTopicYet', async () => {
        const fakes = createUpstreamFakes();

        fakes.scenario('billing-budgets.appBudget');
        const listed = (await call(fakes, 'GET', 'https://billingbudgets.googleapis.com/v1/billingAccounts/0E2E00-0E2E00-0E2E01/budgets'))
            .body as { budgets: Record<string, unknown>[] };

        expect(listed.budgets[0]).toMatchObject({
            displayName: 'historic-city-map demo-hcm',
            amount: { specifiedAmount: { units: '5' } },
            notificationsRule: { disableDefaultIamRecipients: false },
        });
    });

    it('happyPath_theCrashAlertPolicyIsProvisionedOnceAndItsSwitchPatchesIt', async () => {
        const fakes = createUpstreamFakes();
        const policies = 'https://monitoring.googleapis.com/v3/projects/demo-hcm/alertPolicies';
        expect(await call(fakes, 'GET', policies)).toMatchObject({ body: { alertPolicies: [] } });

        fakes.scenario('monitoring.crashAlertsProvisioned');
        fakes.scenario('monitoring.crashAlertsProvisioned');
        const listed = (await call(fakes, 'GET', policies)).body as { alertPolicies: { name: string; displayName: string }[] };
        const [policy] = listed.alertPolicies;
        const patched = await call(fakes, 'PATCH', `https://monitoring.googleapis.com/v3/${String(policy?.name)}?updateMask=enabled`, {
            enabled: false,
        });

        expect(listed.alertPolicies).toHaveLength(1);
        expect(policy).toMatchObject({ displayName: 'historic-city-map new crash reports', enabled: true });
        expect(patched).toMatchObject({ status: 200, body: { enabled: false } });
    });

    it('happyPath_theGapiLoaderIsAnEmptyScriptWithNoFailureOrScenario', async () => {
        const fakes = createUpstreamFakes();

        const response = await fakes.fetch('https://apis.google.com/js/api.js?onload=__iframefcb1', { method: 'GET' });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('javascript');
        const loader = await response.text();
        expect(loader).toMatch(/^\/\/ e2e stand-in/);
        expect(loader).toContain("searchParams.get('onload')");
        expect(() => {
            fakes.fail('google-apis', 'unavailable');
        }).toThrow('google-apis has no failure mode unavailable');
        expect(upstreamHosts()).toContain('apis.google.com');
    });
});
