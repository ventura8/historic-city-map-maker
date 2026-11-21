import { describe, expect, it } from 'vitest';

import { applyProvision, doctorProvision, planProvision } from '../../src/provision/provisioner.js';
import { provisionWorld } from './world.js';

/**
 * The admin's own Hosting site (the `admin-site` item, DECISIONS-for-review.md §210) over the fake Hosting and Identity
 * Toolkit: the site `demo-hcm-admin` made in the project, then its two host names added to Firebase Auth's authorised
 * domains (every other domain kept); an id another project holds says so and adds no domain.
 */
const PREFIX = ['apis'] as const;

describe('the admin-site item', () => {
    it('happyPath_theSiteIsMadeAndItsDomainsJoinFirebaseAuthsOnce', async () => {
        const world = provisionWorld();

        const doctor = await doctorProvision(world.deps, ['admin-site']);
        const report = await applyProvision(planProvision(null, [...PREFIX, 'admin-site']), world.deps);
        const again = await applyProvision(planProvision(null, ['admin-site']), world.deps);

        expect(doctor.items).toEqual([{ id: 'admin-site', state: 'missing' }]);
        expect(report.items.find((item) => item.id === 'admin-site')).toEqual({
            id: 'admin-site',
            state: 'ok',
            params: { site: 'demo-hcm-admin' },
        });
        expect(again.items).toEqual([{ id: 'admin-site', state: 'ok', params: { site: 'demo-hcm-admin' } }]);
        expect(world.fakes.callsTo('start.hosting.sites.create')).toHaveLength(1);
        expect(world.fakes.callsTo('identity-toolkit.updateConfig')).toHaveLength(1);
        expect(world.fakes.state.startWorld.authorizedDomains.get('demo-hcm')).toEqual([
            'localhost',
            'demo-hcm.firebaseapp.com',
            'demo-hcm.web.app',
            'demo-hcm-admin.web.app',
            'demo-hcm-admin.firebaseapp.com',
        ]);
    });

    it('badPath_anIdAnotherProjectHoldsIsNamedAndNoDomainIsAdded', async () => {
        const world = provisionWorld();
        world.fakes.scenario('firebase-hosting.adminSiteTaken');

        const report = await applyProvision(planProvision(null, [...PREFIX, 'admin-site']), world.deps);

        expect(report.items.find((item) => item.id === 'admin-site')).toEqual({
            id: 'admin-site',
            state: 'invalid',
            detail: 'adminSetup.provision.adminSiteTaken',
            params: { site: 'demo-hcm-admin' },
        });
        expect(world.fakes.callsTo('identity-toolkit.updateConfig')).toEqual([]);
    });

    it('badPath_anyOtherRefusalOfTheCreateFailsTheItemWithGooglesReason', async () => {
        const world = provisionWorld();
        world.fakes.fail('firebase-hosting', 'unavailable');

        const report = await applyProvision(planProvision(null, ['admin-site']), world.deps);

        expect(report.items).toEqual([{ id: 'admin-site', state: 'unavailable', detail: 'apiError.unavailable' }]);
    });

    it('badPath_aSiteTheOwnerMayNotReadStopsTheItemWithTheMissingRole', async () => {
        const world = provisionWorld();
        world.fakes.fail('firebase-hosting', 'forbidden');

        const report = await applyProvision(planProvision(null, ['admin-site']), world.deps);

        expect(report.items[0]).toMatchObject({ id: 'admin-site', state: 'invalid' });
        expect(world.fakes.callsTo('start.hosting.sites.create')).toEqual([]);
        expect(world.fakes.callsTo('identity-toolkit.updateConfig')).toEqual([]);
    });

    it('happyPath_aSiteMadeEarlierGetsOnlyItsDomains_andDomainsAlreadyThereAreNotWrittenAgain', async () => {
        const earlier = provisionWorld();
        earlier.fakes.state.startWorld.userSites.set('demo-hcm-admin', 'demo-hcm');
        const named = provisionWorld();
        named.fakes.state.startWorld.authorizedDomains.set('demo-hcm', [
            'demo-hcm.web.app',
            'demo-hcm-admin.web.app',
            'demo-hcm-admin.firebaseapp.com',
        ]);

        const domainsOnly = await applyProvision(planProvision(null, ['admin-site']), earlier.deps);
        const siteOnly = await applyProvision(planProvision(null, ['admin-site']), named.deps);

        expect([domainsOnly.items[0]?.state, siteOnly.items[0]?.state]).toEqual(['ok', 'ok']);
        expect(earlier.fakes.callsTo('start.hosting.sites.create')).toEqual([]);
        expect(earlier.fakes.callsTo('identity-toolkit.updateConfig')).toHaveLength(1);
        expect(named.fakes.callsTo('start.hosting.sites.create')).toHaveLength(1);
        expect(named.fakes.callsTo('identity-toolkit.updateConfig')).toEqual([]);
    });
});
