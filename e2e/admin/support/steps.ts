import { PROVISION_ITEMS, PROVISION_SET_VERSION } from '@hcm/shared';
import { DEFAULT_SOURCES } from '@hcm/shared/sources';
import type { Locator, Page } from '@playwright/test';

import { projectCity } from './content.js';
import type { GoogleConsent } from './consent.js';
import type { EmulatorWorld } from './emulators.js';
import { seedPhotosCity } from './photos.js';
import { SetupPage } from './setup-page.js';
import type { InputFlow } from '../../support/budget.js';

/**
 * What the Setup Assistant's step specs (e2e/admin/steps/) share: the claimed map's city and `setup/status` as the
 * earlier steps left them, and the owner's Google consent for a step's action.
 */

/** When the earlier steps ran (a fixed time). */
export const STEPS_AT = new Date('2026-10-01T09:00:00.000Z');

/** The billing account and budget the billing step records (`FIXTURE_VALUES.billingAccountId`). */
const BUDGET_ID = 'billingAccounts/0E2E00-0E2E00-0E2E01/budgets/0e2e0000-0000-4000-8000-000000000001';

/**
 * The city as the claim created it: its name and bounds, no Mapbox yet. With `sourcesChosen`, the owner also saved the
 * suggested sources (M28, step e2: the city's `sources`), so Setup does not resume on the Sources card, the first step
 * after Mapbox that a spec past it would otherwise find not done.
 */
export async function seedClaimedCity(emulators: EmulatorWorld, ownerUid: string, sourcesChosen = false): Promise<void> {
    const world = projectCity(emulators, ownerUid);
    await seedPhotosCity(world, STEPS_AT);
    if (sourcesChosen) {
        await emulators.updateFields(`cities/${world.city}`, { sources: { ...DEFAULT_SOURCES } }, ['sources']);
    }
}

/** `setup/status` with billing and the project's provisioning done, plus `areas` (each written as given). */
export async function seedSetupStatus(
    emulators: EmulatorWorld,
    ownerUid: string,
    areas: Readonly<Record<string, unknown>> = {},
): Promise<void> {
    const ok = { state: 'ok', checkedAt: STEPS_AT };
    await emulators.setDocument('setup/status', {
        billing: { ...ok, budgetId: BUDGET_ID, budgetAmount: 5, currency: 'USD' },
        provision: { ...ok, items: PROVISION_ITEMS.map((id) => ({ id, ...ok })), setVersion: PROVISION_SET_VERSION },
        ...areas,
        updatedBy: ownerUid,
        updatedAt: STEPS_AT,
    });
}

/** Clicks `action` of a step, allows Google's consent (the owner's account) and returns the scopes it asked for. */
export async function withConsent(
    page: Page,
    consent: GoogleConsent,
    action: Locator,
    inputs: InputFlow,
    consents: InputFlow,
): Promise<string[]> {
    const popup = await consent.opened(page, () => inputs.click(action));
    const scopes = await popup.requestedScopes();
    await popup.allow(consents);
    return scopes;
}

/** Setup, settled, with `step`'s card open. */
export async function openStep(
    page: Page,
    lang: 'ro' | 'en',
    step: Parameters<SetupPage['show']>[0],
    first: Parameters<SetupPage['visit']>[0] = 'billing',
): Promise<Locator> {
    const setup = new SetupPage(page, lang);
    await setup.visit(first);
    return setup.show(step);
}

/** The bootstrap record (`packages/admin/src/setup/bootstrap-record.ts`) as steps (a)–(c), and (d) when `deployed`, left it. */
export function bootstrapRecord(projectId: string, deployed: boolean): Readonly<Record<string, unknown>> {
    const at = STEPS_AT.toISOString();
    const ok = { state: 'ok', checkedAt: at };
    return {
        version: 1,
        projectId,
        updatedAt: at,
        steps: { signIn: ok, billing: ok, provision: ok, ...(deployed ? { deploy: ok } : {}) },
        billing: { accountName: 'billingAccounts/0E2E00-0E2E00-0E2E01', budgetId: BUDGET_ID, budgetAmount: 5, currency: 'USD' },
        provision: { items: PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' ? 'pending' : 'ok' })) },
    };
}

/** The tab's `sessionStorage` holds `record` from its first page on (a reload keeps what the page wrote since). */
export async function rememberBootstrap(page: Page, projectId: string, record: Readonly<Record<string, unknown>>): Promise<void> {
    await page.addInitScript(
        ([key, value]) => {
            if (sessionStorage.getItem('hcm:e2e:seeded') === null) {
                sessionStorage.setItem('hcm:e2e:seeded', '1');
                sessionStorage.setItem(key, value);
            }
        },
        [`hcm:admin:bootstrap:${projectId}`, JSON.stringify(record)] as const,
    );
}
