import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { errorGroupUrl, quotasUrl } from '@hcm/ui/admin';

import { SETUP_LINK_URLS, STEP_LINKS, setupLink, stepLinks } from '../../src/setup/links.js';
import { SETUP_STEPS } from '../../src/setup/steps.js';

interface LinksFile {
    readonly links: readonly { readonly id: string; readonly url: string }[];
}

const LINKS_FILE = JSON.parse(readFileSync(new URL('../../src/setup/links.json', import.meta.url), 'utf8')) as LinksFile;

describe('SETUP_LINK_URLS', () => {
    it('happyPath_theBundledLinksAreExactlyTheVerifiedOnesOfLinksJson', () => {
        const verified = Object.fromEntries(LINKS_FILE.links.map((link) => [link.id, link.url]));

        expect(SETUP_LINK_URLS).toEqual(verified);
    });

    it('happyPath_theCrashDetailLinksTheVerifiedErrorGroupPage', () => {
        // CR-M2c-15: the crash reports page draws the group's link itself (@hcm/ui cannot import the admin's links).
        expect(errorGroupUrl('demo-hcm', 'CNi8 pq/m0')).toBe(
            setupLink('gcp.errorGroup', { projectId: 'demo-hcm', groupId: 'CNi8 pq/m0' }).url,
        );
    });

    it('happyPath_theQuotaLineLinksTheVerifiedQuotasPage', () => {
        // Finding 47 of 2026-11-01: the install cards draw the Quotas page's link themselves, as the crash page does.
        expect(quotasUrl('demo-hcm', 'run.googleapis.com')).toBe(
            setupLink('gcp.quotas', { projectId: 'demo-hcm', service: 'run.googleapis.com' }).url,
        );
    });

    it('happyPath_everyCardLinkIsAnHttpsLinkOfTheFile', () => {
        const ids = SETUP_STEPS.flatMap((step) => STEP_LINKS[step]);

        expect(ids.every((id) => SETUP_LINK_URLS[id].startsWith('https://'))).toBe(true);
    });
});

describe('setupLink', () => {
    it('happyPath_fillsAndEncodesThePlaceholders', () => {
        expect(setupLink('gcp.blazeUpgrade', { projectId: 'demo-hcm' }).url).toBe(
            'https://console.firebase.google.com/project/demo-hcm/usage/details',
        );
        expect(setupLink('usgs.sceneMetadata', { datasetId: 'a/b', entityId: 'DS 1' }).url).toBe(
            'https://earthexplorer.usgs.gov/scene/metadata/full/a%2Fb/DS%201/',
        );
    });

    it('happyPath_aLinkWithoutPlaceholdersNeedsNoValues', () => {
        expect(setupLink('usgs.applicationToken')).toEqual({
            id: 'usgs.applicationToken',
            url: 'https://ers.cr.usgs.gov/password/appgenerate',
        });
    });

    it('badPath_aMissingValueIsAProgrammingError', () => {
        expect(() => setupLink('gcp.blazeUpgrade')).toThrow(RangeError);
    });

    it('happyPath_theBillingCardLinksTheProjectsOwnBlazePage', () => {
        expect(stepLinks('billing', 'demo-hcm').map((link) => link.url)).toEqual([
            'https://console.cloud.google.com/billing',
            'https://console.firebase.google.com/project/demo-hcm/usage/details',
        ]);
        expect(stepLinks('provision', 'demo-hcm')).toEqual([]);
    });
});
