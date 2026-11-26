import { describe, expect, it } from 'vitest';

import { ADMIN_SITE_MAX_LENGTH, SITE_ID_PATTERN, adminSiteId, adminSiteUrl, siteDomains, siteOrigins } from '../../src/index.js';

/**
 * The admin's own Hosting site (DECISIONS-for-review.md §210). The same cases pin the worker's twin
 * (`pipeline/tests/unit/worker/test_args.py`), so both name the same site.
 */
describe('adminSiteId', () => {
    it.each([
        ['bucurestiul-disparut', 'bucurestiul-disparut-admin'],
        ['demo-hcm', 'demo-hcm-admin'],
        ['a-project-id-of-24-chars', 'a-project-id-of-24-chars-admin'],
        ['a-project-id-of-twenty-five', 'a-project-id-of-twenty-f-admin'],
        ['project-with-hyphen-at-24-x', 'project-with-hyphen-at-2-admin'],
        ['abcdefghijklmnopqrstuvw--xyz0', 'abcdefghijklmnopqrstuvw-admin'],
    ])('names %s → %s, a valid site id within the limit', (project, site) => {
        expect(adminSiteId(project)).toBe(site);
        expect(site.length).toBeLessThanOrEqual(ADMIN_SITE_MAX_LENGTH);
        expect(SITE_ID_PATTERN.test(site)).toBe(true);
    });
});

describe("a site's addresses", () => {
    it('gives the web.app origin first, then firebaseapp.com, and their host names', () => {
        expect(siteOrigins('demo-hcm-admin')).toEqual(['https://demo-hcm-admin.web.app', 'https://demo-hcm-admin.firebaseapp.com']);
        expect(siteDomains('demo-hcm-admin')).toEqual(['demo-hcm-admin.web.app', 'demo-hcm-admin.firebaseapp.com']);
    });

    it("keeps the admin's folder on its own site, so a hash route is the same address", () => {
        expect(adminSiteUrl('demo-hcm-admin')).toBe('https://demo-hcm-admin.web.app/admin/');
    });
});
