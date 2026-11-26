/**
 * The Google REST calls of the start page (`docs/research/M14-start-your-map.md` §1): Resource Manager v3's create and
 * search, Firebase Management's addFirebase and web apps, Hosting's sites, versions and releases, Identity Toolkit's Google
 * provider. Each read answers null for a 404, so every step can look before it acts.
 */
import type { HostingServingConfig } from '@hcm/shared';

import { at, records, stringAt, strings } from '../google/json.js';
import type { GoogleTransport } from '../google/transport.js';

const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v3';
const FIREBASE = 'https://firebase.googleapis.com/v1beta1';
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const IDENTITY = 'https://identitytoolkit.googleapis.com/admin/v2';

export interface OwnProject {
    readonly projectId: string;
    readonly displayName: string;
    /** The digits of `projects/<number>`. */
    readonly projectNumber: string;
}

/** A field Google always sends; empty only for an answer no call here would accept. */
function textAt(body: unknown, field: string): string {
    return stringAt(body, field) ?? '';
}

function ownProject(body: unknown): OwnProject {
    return {
        projectId: textAt(body, 'projectId'),
        displayName: textAt(body, 'displayName'),
        projectNumber: textAt(body, 'name').replace(/^projects\//, ''),
    };
}

/** The version's label that says which release of the start page it is. */
export const START_RELEASE_LABEL = 'hcm-start-release';

/** What the live channel serves: the start page's release label, or null for a version something else made. */
export interface LiveRelease {
    readonly label: string | null;
}

export interface StartGoogle {
    listProjects(): Promise<readonly OwnProject[]>;
    getProject(projectId: string): Promise<OwnProject | null>;
    createProject(projectId: string, displayName: string): Promise<void>;
    hasFirebase(projectId: string): Promise<boolean>;
    addFirebase(projectId: string): Promise<void>;
    hasWebApp(projectId: string): Promise<boolean>;
    createWebApp(projectId: string, displayName: string): Promise<void>;
    defaultSite(projectId: string): Promise<string | null>;
    createSite(projectId: string): Promise<string>;
    liveRelease(site: string): Promise<LiveRelease | null>;
    createVersion(site: string, config: HostingServingConfig, labels?: Readonly<Record<string, string>>): Promise<string>;
    populate(version: string, files: Readonly<Record<string, string>>): Promise<{ required: readonly string[]; uploadUrl: string }>;
    finalize(version: string): Promise<void>;
    release(site: string, version: string): Promise<void>;
    googleSignInOn(projectId: string): Promise<boolean>;
}

function projectCalls(transport: GoogleTransport): Pick<StartGoogle, 'listProjects' | 'getProject' | 'createProject'> {
    return {
        listProjects: async () => {
            const items = await transport.pages(
                {
                    operation: 'resource-manager.searchProjects',
                    url: `${RESOURCE_MANAGER}/projects:search`,
                    query: { query: 'state:ACTIVE' },
                },
                'projects',
            );
            return items.map(ownProject);
        },
        getProject: async (projectId) => {
            const body = await transport.find({
                operation: 'resource-manager.getProject',
                url: `${RESOURCE_MANAGER}/projects/${projectId}`,
            });
            return body === undefined ? null : ownProject(body);
        },
        createProject: async (projectId, displayName) => {
            const started = await transport.call({
                operation: 'resource-manager.createProject',
                method: 'POST',
                url: `${RESOURCE_MANAGER}/projects`,
                body: { projectId, displayName },
            });
            await transport.operation(RESOURCE_MANAGER, started, { operation: 'resource-manager.createProject' });
        },
    };
}

function firebaseCalls(
    transport: GoogleTransport,
): Pick<StartGoogle, 'hasFirebase' | 'addFirebase' | 'hasWebApp' | 'createWebApp' | 'googleSignInOn'> {
    return {
        hasFirebase: async (projectId) =>
            (await transport.find({ operation: 'firebase-management.getProject', url: `${FIREBASE}/projects/${projectId}` })) !== undefined,
        addFirebase: async (projectId) => {
            const started = await transport.call({
                operation: 'firebase-management.addFirebase',
                method: 'POST',
                url: `${FIREBASE}/projects/${projectId}:addFirebase`,
                body: {},
            });
            await transport.operation(FIREBASE, started, { operation: 'firebase-management.addFirebase' });
        },
        hasWebApp: async (projectId) => {
            const body = await transport.call({
                operation: 'firebase-management.listWebApps',
                url: `${FIREBASE}/projects/${projectId}/webApps`,
            });
            return records(at(body, 'apps')).some((app) => app['state'] !== 'DELETED');
        },
        createWebApp: async (projectId, displayName) => {
            const started = await transport.call({
                operation: 'firebase-management.createWebApp',
                method: 'POST',
                url: `${FIREBASE}/projects/${projectId}/webApps`,
                body: { displayName },
            });
            await transport.operation(FIREBASE, started, { operation: 'firebase-management.createWebApp' });
        },
        googleSignInOn: async (projectId) => {
            const body = await transport.find({
                operation: 'identity-toolkit.getGoogleProvider',
                url: `${IDENTITY}/projects/${projectId}/defaultSupportedIdpConfigs/google.com`,
            });
            return at(body, 'enabled') === true;
        },
    };
}

function siteCalls(transport: GoogleTransport): Pick<StartGoogle, 'defaultSite' | 'createSite' | 'liveRelease'> {
    return {
        liveRelease: async (site) => {
            // `sites.channels.get`: the channel's `release` is "the current release for the channel, if any".
            const body = await transport.find({
                operation: 'firebase-hosting.getLiveChannel',
                url: `${HOSTING}/sites/${site}/channels/live`,
            });
            const version = at(body, 'release', 'version');
            return version === undefined ? null : { label: stringAt(version, 'labels', START_RELEASE_LABEL) ?? null };
        },
        defaultSite: async (projectId) => {
            const body = await transport.find({ operation: 'firebase-hosting.listSites', url: `${HOSTING}/projects/${projectId}/sites` });
            const site = records(at(body, 'sites')).find((item) => item['type'] === 'DEFAULT_SITE');
            return site === undefined ? null : ((stringAt(site, 'name') ?? '').split('/').pop() ?? null);
        },
        createSite: async (projectId) => {
            await transport.call({
                operation: 'firebase-hosting.createSite',
                method: 'POST',
                url: `${HOSTING}/projects/${projectId}/sites`,
                query: { siteId: projectId },
                body: {},
            });
            return projectId;
        },
    };
}

function versionCalls(transport: GoogleTransport): Pick<StartGoogle, 'createVersion' | 'populate' | 'finalize' | 'release'> {
    return {
        createVersion: async (site, config, labels = {}) => {
            const body = await transport.call({
                operation: 'firebase-hosting.createVersion',
                method: 'POST',
                url: `${HOSTING}/sites/${site}/versions`,
                body: { config, labels },
            });
            return textAt(body, 'name');
        },
        populate: async (version, files) => {
            const body = await transport.call({
                operation: 'firebase-hosting.populateFiles',
                method: 'POST',
                url: `${HOSTING}/${version}:populateFiles`,
                body: { files },
            });
            return { required: strings(at(body, 'uploadRequiredHashes')), uploadUrl: textAt(body, 'uploadUrl') };
        },
        finalize: async (version) => {
            await transport.call({
                operation: 'firebase-hosting.finalizeVersion',
                method: 'PATCH',
                url: `${HOSTING}/${version}`,
                query: { update_mask: 'status' },
                body: { status: 'FINALIZED' },
            });
        },
        release: async (site, version) => {
            await transport.call({
                operation: 'firebase-hosting.createRelease',
                method: 'POST',
                url: `${HOSTING}/sites/${site}/releases`,
                query: { versionName: version },
                body: {},
            });
        },
    };
}

export function createStartGoogle(transport: GoogleTransport): StartGoogle {
    return { ...projectCalls(transport), ...firebaseCalls(transport), ...siteCalls(transport), ...versionCalls(transport) };
}
