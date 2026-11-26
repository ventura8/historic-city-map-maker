import { describe, expect, it } from 'vitest';

import { adminReleaseFields, installPlace, onOwnSite, ownSiteId } from '../../src/app/admin-site.js';

/** §210: the admin's own site is the origin its `runtime.json` names, and only that one. */
const OWN = 'https://demo-hcm-admin.web.app';

describe('the admin on its own site', () => {
    it('happyPath_theOriginTheRuntimeNamesIsTheAdminsOwnSite', () => {
        const runtime = { adminOrigin: OWN };

        expect(onOwnSite(runtime, OWN)).toBe(true);
        expect(ownSiteId('demo-hcm', runtime, OWN)).toBe('demo-hcm-admin');
    });

    it('badPath_thePublicMapsOriginOrARuntimeWithoutTheFieldIsNot', () => {
        expect(onOwnSite({ adminOrigin: OWN }, 'https://demo-hcm.web.app')).toBe(false);
        expect(onOwnSite({}, OWN)).toBe(false);
        expect(ownSiteId('demo-hcm', {}, OWN)).toBeNull();
    });
});

describe('what the boot takes from it', () => {
    it('happyPath_onItsOwnSiteTheAdminInstallsFromHostingAndNamesTheSite', () => {
        expect(installPlace('demo-hcm', { adminOrigin: OWN }, OWN, true)).toEqual({
            installOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com', OWN, 'https://demo-hcm-admin.firebaseapp.com'],
            adminSite: 'demo-hcm-admin',
        });
        expect(adminReleaseFields({ release: '1.0.0+abc1234' })).toEqual({ release: '1.0.0+abc1234', releaseTime: null });
        expect(adminReleaseFields({ release: 'r', releaseTime: 5 })).toEqual({ release: 'r', releaseTime: 5 });
    });

    it('badPath_elsewhereTheE2eBuildInstallsFromItsOwnOriginAndNamesNoSite', () => {
        const origin = 'http://127.0.0.1:4312';

        expect(installPlace('demo-hcm', {}, origin, false)).toEqual({ installOrigins: [origin], adminSite: null });
    });
});
