/**
 * Settings → The city's budget (`packages/admin/src/cities/budget-section.ts`, M5-interfaces §1.8; behaviour A52): the
 * limits and what the city used, the project owner's Save, everyone else read-only, the section's listeners per visit.
 */
import { DEFAULT_NEW_CITY_LIMITS, FIRESTORE_PATHS, MAX_CITY_LIMITS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { BudgetSection, draftLimits, NO_BUDGET_SECTION, usedOf, type BudgetSectionState } from '../../src/cities/budget-section.js';
import { settingsModule } from '../../src/settings/settings.js';
import { failure, settle } from '../app/fakes.js';
import { at, CITY, contentWorld } from '../content/world.js';
import { cityDoc } from '../layers/fixtures.js';

const MONTH = '2026-10';
const NOW = Date.parse('2026-10-24T08:00:00.000Z');
const LIMITS = { ...DEFAULT_NEW_CITY_LIMITS, computeUnitsPerMonth: 8 };

function world(role: 'owner' | 'admin' = 'owner') {
    const content = contentWorld();
    content.clock.current = NOW;
    content.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ limits: LIMITS }));
    content.store.docs.set(FIRESTORE_PATHS.admin('admin-uid'), {
        role,
        createdAt: at('2026-10-01T00:00:00Z'),
        updatedBy: 'x',
        updatedAt: at('2026-10-01T00:00:00Z'),
    });
    content.store.docs.set(FIRESTORE_PATHS.cityUsage(CITY, MONTH), {
        month: MONTH,
        computeUnits: 2,
        reservations: { v1: { computeUnits: 1.5, at: at('2026-10-20T00:00:00Z') } },
        aiRequests: 7,
        geocodeDay: '2026-10-24',
        geocodeToday: 3,
        updatedBy: 'system:cities',
        updatedAt: at('2026-10-20T00:00:00Z'),
    });
    const states: BudgetSectionState[] = [];
    const section = new BudgetSection(content.services, (state) => states.push(state));
    return { ...content, section, states };
}

describe('the city budget section', () => {
    it('happyPath_theOwnerSeesTheLimitsAndUseAndSavesAChange @S-A52-HAPPY', async () => {
        const w = world();
        w.callables.answer('cities.setLimits', (request) => ({ limits: request.limits }));

        w.section.open();
        await settle();
        expect(w.section.state).toMatchObject({
            status: 'ready',
            owner: true,
            limits: LIMITS,
            used: { computeUnitsPerMonth: 3.5, aiRequestsPerMonth: 7, geocodeCellsPerDay: 3 },
        });
        w.section.intents.setLimit('rasterJobsPerDay', '5');
        await expect(w.section.intents.saveLimits()).resolves.toBe(true);

        expect(w.callables.calls.find((call) => call.name === 'cities.setLimits')?.request).toEqual({
            cityId: CITY,
            limits: { ...LIMITS, rasterJobsPerDay: 5 },
        });
        expect(w.section.state).toMatchObject({ draft: {}, saving: false, limits: { rasterJobsPerDay: 5 } });
        expect(w.notices).toEqual([{ key: 'adminContent.budgets.saved' }]);
    });

    it('badPath_anAdminWhoIsNotTheProjectsOwnerReadsThemOnly @S-A52-BAD-NOT-PROJECT-OWNER', async () => {
        const w = world('admin');
        w.callables.fail('cities.setLimits', failure('permission-denied', 'apiError.city.notProjectOwner'));

        w.section.open();
        await settle();
        w.section.intents.setLimit('computeUnitsPerMonth', '9');

        expect(w.section.state.owner).toBe(false);
        await expect(w.section.intents.saveLimits()).resolves.toBe(false);
        expect(w.section.state.error).toEqual({ key: 'apiError.city.notProjectOwner' });
        w.section.intents.discardLimits();
        expect(w.section.state).toMatchObject({ draft: {}, error: null });
    });

    it.each([
        ['an empty field', 'computeUnitsPerMonth', ''],
        ['more daily jobs than the project allows', 'rasterJobsPerDay', '11'],
        ['a negative number', 'exportsPerDay', '-1'],
    ] as const)('badPath_%s_isRefusedWithoutACall', async (_name, field, text) => {
        const w = world();
        w.section.open();
        await settle();
        w.section.intents.setLimit(field, text);

        await expect(w.section.intents.saveLimits()).resolves.toBe(false);

        expect(w.section.state.error).toEqual({ key: 'adminContent.budgets.invalid' });
        expect(w.callables.named('cities.setLimits')).toBe(0);
    });

    it('happyPath_aCityWithoutLimitsGetsOnlyTheOneTypedAndUsesNothingYet', () => {
        // docs/LESSONS.md 256: the new-city defaults came with the one limit typed (3 imagery jobs a day for Bucharest).
        expect(draftLimits({ limits: null, draft: { exportsPerDay: '2' } })).toEqual({
            limits: { ...MAX_CITY_LIMITS, exportsPerDay: 2 },
        });
        expect(usedOf(null, new Date(NOW))).toEqual({});
        expect(
            usedOf(
                {
                    month: MONTH,
                    computeUnits: 1,
                    aiRequests: 0,
                    geocodeDay: '2026-10-23',
                    geocodeToday: 4,
                    updatedBy: 'x',
                    updatedAt: at('2026-10-20T00:00:00Z'),
                },
                new Date(NOW),
            ),
        ).toEqual({
            computeUnitsPerMonth: 1,
            aiRequestsPerMonth: 0,
            geocodeCellsPerDay: 0,
        });
    });

    it('badPath_aRefusedReadIsAnErrorUntilTryAgainAndClosingForgetsEverything', async () => {
        const w = world();
        w.section.open();
        await settle();
        w.store.fail(FIRESTORE_PATHS.cityUsage(CITY, MONTH), { kind: 'denied', code: 'permission-denied' });
        await settle();
        expect(w.section.state).toMatchObject({ status: 'error', failure: { kind: 'denied' } });
        expect(w.denials.count).toBeGreaterThan(0);

        w.section.intents.retryBudget();
        await settle();
        expect(w.section.state.status).toBe('ready');
        w.section.close();
        expect(w.section.state).toEqual(NO_BUDGET_SECTION);
    });

    it('happyPath_theSettingsStoreOpensTheSectionOnItsRouteAndClosesItOnLeaving', async () => {
        const content = contentWorld();
        content.clock.current = NOW;
        content.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
        const settings = settingsModule({ passes: () => true }).create(content.services);
        const usage = FIRESTORE_PATHS.cityUsage(CITY, MONTH);

        settings.open(['budget']);
        await settle();
        const opened = content.store.listeners(usage);
        settings.open(['budget']);
        const again = content.store.listeners(usage);
        settings.open(['texts']);
        await settle();

        expect([opened, again, content.store.listeners(usage)]).toEqual([1, 1, 0]);
        expect(settings.state.budget).toEqual(NO_BUDGET_SECTION);
        settings.close();
    });
});
