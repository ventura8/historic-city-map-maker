import { MAPBOX_TOKENS } from '@hcm/test-support/fakes';

import { expectStateSound } from '../../support/state-check.js';
import { adminVisit } from '../../tour/states.js';
import type { Locator, Page } from '@playwright/test';

import { projectCity } from '../support/content.js';
import { apiText, setupText } from '../support/i18n.js';
import { seedPhotosCity } from '../support/photos.js';
import { SetupPage } from '../support/setup-page.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { emulatorOrigin } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's Mapbox step (docs/research/M2b-interfaces.md §3.3 e; behaviours A05, A06) on a claimed map, its
 * owner signed in: the secret token pasted into the card goes once to `setup.saveMapbox`, which proves the account with
 * the fake Mapbox (the server's world of the fake upstreams) and mints the viewer's public token. Each Mapbox answer the
 * owner can meet is a token of `MAPBOX_TOKENS` or a failure of the fake: a paid account, one blocked on its billing
 * details, one without every scope, a revoked token, Mapbox down; a public token is explained before any call.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** When the claim created the city (a fixed time). */
const AT = new Date('2026-10-01T09:00:00.000Z');

/** The city as the claim created it: its name and bounds, no Mapbox yet. */
test.beforeEach(async ({ adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    // The project was provisioned: the secrets the server keeps the token in exist.
    await upstream.scenario('google.provisioned', 'server');
});

/** The Mapbox card of Setup, open. */
async function mapboxCard(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    const setup = new SetupPage(page, lang);
    await setup.visit();
    return setup.show('mapbox');
}

/** The leading text of a catalogue text with a placeholder, as a pattern (a link's name ends with "opens in a new tab"). */
function startOf(text: string): RegExp {
    return new RegExp(`^${(text.split('{')[0] ?? '').replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** The requests of the page to the Functions emulator (the callables), by path. */
function callables(page: Page): string[] {
    const paths: string[] = [];
    page.on('request', (request) => {
        if (request.url().startsWith(emulatorOrigin('functions'))) {
            paths.push(new URL(request.url()).pathname);
        }
    });
    return paths;
}

test(
    'A paid account: the pasted secret token is saved at once, mints the public token and the step is green, in one input',
    { tag: ['@S-A05-HAPPY'] },
    async ({ page, lang, setupBudget, adminWorld }) => {
        const card = await mapboxCard(page, lang);
        const inputs = setupBudget.inputs('mapbox');
        // The paste is the whole step: no Save click.
        await inputs.paste(card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')), MAPBOX_TOKENS.bootstrap);

        const setup = new SetupPage(page, lang);
        await setup.expectState('mapbox', 'ok');
        // Setup moves on to the next step; the Mapbox card, opened again, names the account.
        const saved = await setup.show('mapbox');
        await expect(saved.getByText(setupText(lang, 'adminSetup.mapbox.saved', { user: 'e2e-mapbox' }))).toBeVisible();
        const city = await adminWorld.emulators.document('cities/bucharest');
        expect(city).toEqual(expect.objectContaining({ mapbox: expect.objectContaining({ publicToken: expect.stringMatching(/^pk\./) }) }));
        expect(JSON.stringify(city)).not.toContain(MAPBOX_TOKENS.bootstrap);
        expect(inputs.used).toBe(1);
    },
);

test(
    'An account blocked on its billing details: Mapbox refuses the public token, the card says why with the console link, nothing kept',
    { tag: ['@S-A05-BAD-MISSING-BILLING-ADDRESS'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.billingPending);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.mapbox.mintRefused'));
        await expect(card.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.console')) })).toHaveAttribute(
            'href',
            'https://console.mapbox.com/',
        );
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        const secrets = await upstream.calls('server', 'secret-manager');
        expect(secrets.filter((call) => call.body.includes(Buffer.from(MAPBOX_TOKENS.billingPending).toString('base64')))).toEqual([]);
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A token without every scope: the card names the missing scopes and links the token page; nothing stored',
    { tag: ['@S-A06-BAD-MISSING-SCOPES'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.missingScopes);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();

        await expect(card.getByRole('alert')).toHaveText(
            apiText(lang, 'apiError.mapbox.missingScopes', { scopes: 'tilesets:write, tokens:write' }),
        );
        await expect(card.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.accessTokens')) })).toHaveAttribute(
            'href',
            'https://console.mapbox.com/account/access-tokens/',
        );
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        expect(consoleErrors.takeMatching(/status of 4\d\d/).length).toBeGreaterThan(0);
    },
);

test(
    'A public token pasted by mistake is explained in the page before any call',
    { tag: ['@S-A06-BAD-PUBLIC-TOKEN-PASTED'] },
    async ({ page, lang }) => {
        const card = await mapboxCard(page, lang);
        const calls = callables(page);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.defaultPublic);

        await expect(card.getByRole('status').filter({ hasText: apiText(lang, 'apiError.mapbox.publicToken') })).toBeVisible();
        expect(calls.filter((path) => path.includes('setup-saveMapbox'))).toEqual([]);
    },
);

test(
    'A revoked token is reported and the Mapbox chip turns invalid',
    { tag: ['@S-A06-BAD-REVOKED'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.revoked);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.mapbox.tokenInvalid'));
        await new SetupPage(page, lang).expectState('mapbox', 'invalid');
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        expect(consoleErrors.takeMatching(/status of 4\d\d/).length).toBeGreaterThan(0);
    },
);

test(
    'Mapbox down: the card says to try again and nothing is half-saved; once it answers, the same token typed and saved connects',
    { tag: ['@S-A06-BAD-MAPBOX-5XX'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await upstream.fail('mapbox', 'unavailable', 'server');
        const card = await mapboxCard(page, lang);
        const box = card.getByLabel(setupText(lang, 'adminSetup.mapbox.token'));
        const save = card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') });
        await box.fill(MAPBOX_TOKENS.bootstrap);
        await save.click();

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.mapbox.unavailable'));
        await new SetupPage(page, lang).expectState('mapbox', 'unavailable');
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        expect(consoleErrors.takeMatching(/status of 5\d\d/).length).toBeGreaterThan(0);

        await upstream.fail('mapbox', null, 'server');
        await box.fill(MAPBOX_TOKENS.bootstrap);
        await save.click();
        await new SetupPage(page, lang).expectState('mapbox', 'ok');
    },
);

test(
    "Replacing the visitors' token, once confirmed, puts a new URL-restricted token in the city and says when the old one goes",
    { tag: ['@S-A06-HAPPY-ROTATE'] },
    async ({ page, lang, adminWorld }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.bootstrap);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();
        const setup = new SetupPage(page, lang);
        await setup.expectState('mapbox', 'ok');
        const before = ((await adminWorld.emulators.document('cities/bucharest'))?.['mapbox'] as { publicToken?: string } | undefined)
            ?.publicToken;
        const saved = await setup.show('mapbox');

        // One click and the confirmation (the panic button of security review §1.3).
        await saved.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.rotate.viewer') }).click();
        const dialog = page.getByRole('dialog', { name: setupText(lang, 'adminSetup.mapbox.rotate.confirmViewer') });
        await expect(dialog).toBeVisible();
        await expectStateSound(page, adminVisit('mapbox-rotate-confirm', lang));
        const rotated = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-rotatePublicToken`);
        await page
            .locator('hcm-confirm-dialog')
            .filter({ has: dialog })
            .getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.rotate.confirm'), exact: true })
            .click();
        expect((await rotated).status()).toBe(200);

        // The card says when the old token goes (ops.tick deletes it ten minutes later: functions/test/ops).
        await expect(
            saved.getByRole('status').filter({ hasText: startOf(setupText(lang, 'adminSetup.mapbox.rotate.done')) }),
        ).toBeVisible();
        await expect
            .poll(
                async () =>
                    ((await adminWorld.emulators.document('cities/bucharest'))?.['mapbox'] as { publicToken?: string } | undefined)
                        ?.publicToken,
            )
            .toMatch(/^pk\./);
        const after = ((await adminWorld.emulators.document('cities/bucharest'))?.['mapbox'] as { publicToken?: string } | undefined)
            ?.publicToken;
        expect(after).not.toBe(before);
    },
);

// M6 setup-ux (docs/research/M6-interfaces.md §3.1; finding 15 of docs/research/manual-test-2026-10-25.md): each deep
// link's label says what its page does (links.json's purpose), and advice for that page is a hint beside the link.

/** The Mapbox card's deep links, in order, each with its address. */
const MAPBOX_LINKS = [
    ['adminSetup.link.mapbox.signup', 'https://account.mapbox.com/auth/signup/'],
    ['adminSetup.link.mapbox.console', 'https://console.mapbox.com/'],
    ['adminSetup.link.mapbox.usageThresholds', 'https://console.mapbox.com/account/settings/usage-thresholds'],
    ['adminSetup.link.mapbox.accessTokens', 'https://console.mapbox.com/account/access-tokens/'],
] as const;

test(
    "Every deep link's label says what its page does; the console's reads Open the Mapbox console",
    { tag: ['@S-A05-HAPPY-LINK-LABELS'] },
    async ({ page, lang }) => {
        const card = await mapboxCard(page, lang);

        for (const [key, url] of MAPBOX_LINKS) {
            await expect(card.getByRole('link', { name: startOf(setupText(lang, key)) })).toHaveAttribute('href', url);
        }
        // The console's link opens the console's home (links.json): its label says so, and the payment advice is its hint
        // (finding 7 of the M6 review: "Add the payment method" promised a page the link does not open).
        expect(setupText('en', 'adminSetup.link.mapbox.console')).toBe('Open the Mapbox console');
        await expect(card.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.console')) })).toHaveAttribute(
            'target',
            '_blank',
        );
    },
);

test(
    'A hint for another page sits beside its link, never inside it: no link text holds a parenthesis',
    { tag: ['@S-A05-BAD-HINT-APART'] },
    async ({ page, lang }) => {
        const card = await mapboxCard(page, lang);
        const newTab = setupText(lang, 'adminSetup.newTab');

        const names = await card
            .locator('ul.links a')
            .evaluateAll((links, hidden) => links.map((link) => link.textContent.replace(hidden, '').trim()), newTab);
        expect(names).toHaveLength(MAPBOX_LINKS.length);
        expect(names.filter((name) => /[()]/.test(name))).toEqual([]);
        const hint = card.locator('[data-hint="mapbox.console"]');
        await expect(hint).toHaveText(setupText(lang, 'adminSetup.linkHint.mapbox.console'));
        // The hint is in the console link's own row of the list, after the link.
        const row = card.locator('ul.links li').filter({ has: page.locator('[data-hint="mapbox.console"]') });
        await expect(row.locator('a')).toHaveAttribute('href', 'https://console.mapbox.com/');
    },
);
