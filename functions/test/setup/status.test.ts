/**
 * `setup.status` and the lenient projection of `setup/status` (M2-interfaces §3.3; scenarios A03): the six areas as the
 * Setup Assistant shows them, field by field, so one malformed value never breaks the screen and nothing outside the
 * view schema ever leaves the function.
 */
import { FIRESTORE_PATHS, PROVISION_ITEMS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { setupStatus } from '../../src/setup/status.js';
import { toSetupStatusView } from '../../src/setup/view.js';
import { ADMIN, NOW, createWorld } from './world.js';

const AT = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };
const ISO = '2026-10-11T08:30:00.000Z';
const missing = { state: 'missing', checkedAt: null };

describe('setup.status', () => {
    it('happyPath_aFreshProjectShowsEveryAreaMissing', async () => {
        const world = createWorld();

        await expect(setupStatus(world.deps, ADMIN)).resolves.toEqual({
            billing: missing,
            provision: { ...missing, items: [] },
            mapbox: missing,
            usgs: missing,
            analytics: missing,
            crash: missing,
            secretsRev: 0,
            ready: false,
            generatedAt: ISO,
        });
        expect(world.records).toEqual([
            { level: 'info', scope: 'functions', message: 'setup status read', data: { uid: ADMIN.uid, ready: false } },
        ]);
    });

    it('happyPath_theStoredAreasAreShownWithTheirTimesAndReasons', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, {
            billing: {
                state: 'ok',
                checkedAt: AT,
                budgetId: 'billingAccounts/0E2E00-0E2E00-0E2E01/budgets/b1',
                budgetAmount: 5,
                currency: 'USD',
            },
            provision: { state: 'ok', checkedAt: AT, items: PROVISION_ITEMS.map((id) => ({ id, state: 'ok', checkedAt: AT })) },
            mapbox: {
                state: 'ok',
                checkedAt: AT,
                user: 'e2e-mapbox',
                scopes: ['styles:read'],
                adminToken: 'pk.e2e-admin',
                adminAllowedUrls: ['https://demo-hcm.web.app'],
            },
            usgs: { state: 'pending', checkedAt: AT, role: 'search', nextCheckAt: AT, tokenExpiresAt: AT },
            analytics: { state: 'invalid', checkedAt: AT, detail: 'apiError.cloud.permission', params: { role: 'roles/firebase.viewer' } },
            crash: { state: 'ok', checkedAt: AT, lastReportAt: AT },
            secretsRev: 3,
            updatedBy: ADMIN.uid,
            updatedAt: AT,
        });

        const view = await setupStatus(world.deps, ADMIN);

        expect(view).toMatchObject({
            billing: { state: 'ok', checkedAt: ISO, budgetAmount: 5, currency: 'USD' },
            mapbox: { state: 'ok', user: 'e2e-mapbox', adminToken: 'pk.e2e-admin' },
            usgs: { state: 'pending', role: 'search', nextCheckAt: ISO, tokenExpiresAt: ISO },
            analytics: { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/firebase.viewer' } },
            crash: { state: 'ok', lastReportAt: ISO },
            secretsRev: 3,
            ready: false,
        });
        expect(view.provision.items).toHaveLength(PROVISION_ITEMS.length);
        expect(view.provision.items[0]).toEqual({ id: 'apis', state: 'ok' });
    });

    it('badPath_nothingOutsideTheViewSchemaLeavesTheFunction @S-A03-BAD-NOTHING-SECRET-LEAVES', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, {
            mapbox: {
                state: 'ok',
                token: 'sk.e2e-never-returned',
                tilesTokenId: 'tiles01',
                adminTokenId: 'admin01',
                retiring: [{ tokenId: 'x', retireAt: AT }],
            },
            usgsAppToken: 'e2e-never-returned',
            secretsRev: 2,
        });

        const view = await setupStatus(world.deps, ADMIN);

        expect(view.mapbox).toEqual({ state: 'ok', checkedAt: null });
        expect(JSON.stringify(view)).not.toMatch(/never-returned|tiles01|admin01|retiring/);
    });

    it('badPath_malformedFieldsFallBackToTheirDefaults', () => {
        const items = [
            { id: 'apis', state: 'ok' },
            { id: 'not-an-item', state: 'ok' },
            'apis',
            ...Array.from({ length: 20 }, () => ({ id: 'secrets', state: 'pending' })),
        ];
        const view = toSetupStatusView(
            {
                billing: { state: 'bogus', checkedAt: '2026-10-11', currency: 'dollars', budgetAmount: 5 },
                provision: { state: 'ok', items },
                mapbox: 'ok',
                usgs: { state: 'ok', checkedAt: { seconds: Number.POSITIVE_INFINITY, nanoseconds: 0 } },
                analytics: null,
                crash: [],
                secretsRev: -1,
            },
            new Date(NOW),
        );

        expect(view.billing).toEqual({ state: 'missing', checkedAt: null, budgetAmount: 5 });
        expect(view.provision.state).toBe('ok');
        expect(view.provision.items).toHaveLength(PROVISION_ITEMS.length);
        expect(view.provision.items[0]).toEqual({ id: 'apis', state: 'ok' });
        expect([view.mapbox, view.usgs, view.analytics, view.crash]).toEqual([missing, { state: 'ok', checkedAt: null }, missing, missing]);
        expect(view.secretsRev).toBe(0);
    });

    it.each([1.5, '3', Number.MAX_SAFE_INTEGER + 2])('badPath_revision_%s_readsAsZero', (secretsRev) => {
        expect(toSetupStatusView({ secretsRev }, new Date(NOW)).secretsRev).toBe(0);
    });

    it('happyPath_readyOnceBillingProvisionMapboxAndUsgsAreOk', () => {
        const ok = { state: 'ok' };

        const view = toSetupStatusView({ billing: ok, provision: ok, mapbox: ok, usgs: ok }, new Date(NOW));

        expect(view.ready).toBe(true);
    });
});
