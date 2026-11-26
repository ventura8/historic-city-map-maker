import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { setupText, shellText, templatePattern } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { bootstrapRecord, rememberBootstrap, withConsent } from '../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { ADMIN_RUNTIME, E2E_PROJECT_ID, PERSONAS } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The server's installation and the claim that follows it (docs/research/M2b-interfaces.md §3.3 d, d2; behaviour A26),
 * from the bootstrap record steps (a)–(c) left in the tab: the card lists the Cloud Functions of the owner's Google
 * world every 30 s of the page's clock and says how far the installation got, or which function failed, claiming
 * nothing meanwhile; a page that lost its Google token claims with one click and one read-only consent.
 */

test(
    'A partial installation shows how many functions are ready and claims nothing; a failed function is named',
    { tag: ['@S-A26-BAD-PARTIAL-DEPLOY'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment, adminWorld }) => {
        await upstream.scenario('google.provisioned', 'browser');
        await upstream.scenario('service-usage.allEnabled', 'browser');
        await upstream.scenario('cloud-functions.partial', 'browser');
        await serverDeployment.hide();
        await page.route('**/runtime.json', (route) => route.fulfill({ json: { ...ADMIN_RUNTIME, startUp: true } }));
        await rememberBootstrap(page, E2E_PROJECT_ID, bootstrapRecord(E2E_PROJECT_ID, false));
        await page.clock.install();
        await page.clock.resume();
        await page.goto(adminPath(lang));
        const signIn = await consent.opened(page, () =>
            inputBudget.flow('signIn', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
        );
        await signIn.chooseAccount(PERSONAS.owner.email);
        await signIn.allow(inputBudget.flow('signInConsent', 1));

        // The record's steps are done; the deployment is watched once Google allows listing the functions.
        const setup = new SetupPage(page, lang);
        await setup.expectState('provision', 'ok');
        const deploy = await setup.show('deploy');
        const scopes = await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
            setupBudget.inputs('deploy', 1),
            setupBudget.consents('deploy', 1),
        );
        expect(scopes).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await expect(
            deploy.getByText(templatePattern(setupText(lang, 'adminSetup.deploy.progress', { ready: '\u0000', total: '\u0000' }))),
        ).toBeVisible();
        await setup.expectState('deploy', 'pending');
        expect(await adminWorld.emulators.document('setup/owner')).toBeUndefined();

        // The installation ends with one function failed; the next look names it.
        await upstream.scenario('cloud-functions.failed', 'browser');
        await page.clock.fastForward(30_000);
        await expect(deploy.getByText(templatePattern(setupText(lang, 'adminSetup.deploy.failed', { name: '\u0000' })))).toBeVisible();
        await setup.expectState('deploy', 'invalid');
        expect(await adminWorld.emulators.document('setup/owner')).toBeUndefined();
        expect(serverDeployment.claimErrors()).toEqual([]);
    },
);

test.describe('the owner, signed in, back after the server appeared', () => {
    test.use({ persona: 'owner' });

    test(
        'Without a live Google token the claim costs one click and one read-only consent; nothing is claimed before it',
        { tag: ['@S-A26-BAD-TOKEN-GONE', '@S-A66-HAPPY-SEED'] },
        async ({ page, lang, consent, setupBudget, adminWorld }) => {
            await rememberBootstrap(page, E2E_PROJECT_ID, bootstrapRecord(E2E_PROJECT_ID, true));
            await page.goto(adminPath(lang));

            const claim = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') });
            await expect(claim).toBeVisible();
            expect(await adminWorld.emulators.document('setup/owner')).toBeUndefined();
            const scopes = await withConsent(page, consent, claim, setupBudget.inputs('claim', 1), setupBudget.consents('claim', 1));
            expect(scopes).toEqual([GOOGLE_SCOPES.cloudReadOnly]);

            // Claimed: the owner's record, then what the bootstrap found reaches the server and leaves the tab.
            const owner = adminWorld.accounts.owner.uid;
            await expect.poll(() => adminWorld.emulators.document(`admins/${owner}`)).toEqual(expect.objectContaining({ role: 'owner' }));
            await expect
                .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['billing'])
                .toMatchObject({ state: 'ok', budgetAmount: 5 });
            expect(await adminWorld.emulators.document('cities/bucharest')).toEqual(expect.objectContaining({ updatedBy: owner }));
            // The bundled city's target years, which only `setup.createCity` writes (M8).
            expect(await adminWorld.emulators.document('cities/bucharest')).toMatchObject({
                imagery: { targetYears: [1966, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] },
            });
            await expect.poll(() => page.evaluate(() => sessionStorage.getItem('hcm:admin:bootstrap:demo-hcm'))).toBeNull();
        },
    );
});
