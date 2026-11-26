/**
 * The Setup Assistant's verified deep links (`links.json` beside this file, the copy `scripts/ci/check_contracts.py`
 * probes every week). The TypeScript copy below is what the admin bundles; `packages/admin/test/setup/links.test.ts`
 * fails when the two differ. Every link opens in a new tab; following one is not an in-app input (§3.5).
 */
import type { SetupStepId } from './steps.js';

export const SETUP_LINK_URLS = {
    'gcp.firebaseConsole': 'https://console.firebase.google.com/',
    'gcp.billingAccounts': 'https://console.cloud.google.com/billing',
    // The billing card's primary Create a billing account while it waits for one (M6 setup-ux, finding 3).
    'gcp.billingCreate': 'https://console.cloud.google.com/billing/create',
    'gcp.blazeUpgrade': 'https://console.firebase.google.com/project/{projectId}/usage/details',
    'mapbox.signup': 'https://account.mapbox.com/auth/signup/',
    'mapbox.console': 'https://console.mapbox.com/',
    'mapbox.usageThresholds': 'https://console.mapbox.com/account/settings/usage-thresholds',
    'mapbox.accessTokens': 'https://console.mapbox.com/account/access-tokens/',
    'usgs.register': 'https://ers.cr.usgs.gov/register',
    'usgs.accessRequest': 'https://ers.cr.usgs.gov/profile/access',
    'usgs.applicationToken': 'https://ers.cr.usgs.gov/password/appgenerate',
    'usgs.sceneMetadata': 'https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/',
    // The crash reports page's detail (CR-M2c-15), not a Setup card's: `errorGroupUrl` of @hcm/ui/admin draws it.
    'gcp.errorGroup': 'https://console.cloud.google.com/errors/detail/{groupId}?project={projectId}',
    // The install cards' quota line (finding 47 of 2026-11-01): `quotasUrl` of @hcm/ui/admin draws it.
    'gcp.quotas': 'https://console.cloud.google.com/iam-admin/quotas?project={projectId}&service={service}',
} as const;

export type SetupLinkId = keyof typeof SETUP_LINK_URLS;

/** The links a Setup card lists (the error group's page is the crash reports page's own, CR-M2c-15). */
export type SetupCardLinkId = Exclude<SetupLinkId, 'gcp.errorGroup' | 'gcp.quotas'>;

export interface SetupLinkView {
    readonly id: SetupCardLinkId;
    readonly url: string;
}

/** The links each card lists, in the order the human follows them (the USGS token page has its own countdown button). */
export const STEP_LINKS: Readonly<Record<SetupStepId, readonly SetupCardLinkId[]>> = {
    signIn: ['gcp.firebaseConsole'],
    billing: ['gcp.billingAccounts', 'gcp.blazeUpgrade'],
    provision: [],
    deploy: [],
    claim: [],
    // [section install] owner: installer (M6, CR-M6-6): the install cards link no console page.
    pipeline: [],
    // [end install]
    mapbox: ['mapbox.signup', 'mapbox.console', 'mapbox.usageThresholds', 'mapbox.accessTokens'],
    // M28: the platform and sources cards link the steps' own pages (each section and source names the step's link).
    platform: [],
    sources: [],
    usgs: ['usgs.register', 'usgs.accessRequest'],
    analytics: ['gcp.firebaseConsole'],
    legacyImport: [],
    // [section install] owner: installer (M6, CR-M6-6)
    site: [],
    // [end install]
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** The link `id` with its `{name}` placeholders filled (URL-encoded); a missing value is a programming error. */
export function setupLink<Id extends SetupLinkId>(
    id: Id,
    params: Readonly<Record<string, string>> = {},
): { readonly id: Id; readonly url: string } {
    const url = SETUP_LINK_URLS[id].replace(PLACEHOLDER, (_placeholder: string, name: string) => {
        const value = params[name];
        if (value === undefined) {
            throw new RangeError(`link ${id} needs {${name}}`);
        }
        return encodeURIComponent(value);
    });
    return { id, url };
}

/** The deep links of `step` for the project. */
export function stepLinks(step: SetupStepId, projectId: string): readonly SetupLinkView[] {
    return STEP_LINKS[step].map((id) => setupLink(id, { projectId }));
}
