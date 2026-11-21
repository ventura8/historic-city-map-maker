/**
 * The steps from nothing to a live admin (`docs/research/M14-start-your-map.md` §1, §7). Each looks before it acts, so
 * **Try again** is the first click's action from anywhere and nothing is made twice. Only `releases.create` changes the
 * site: stopping before it leaves whatever was live, and a site that already went on is never released over. The token is
 * the transport's; nothing here holds it.
 */
import type { StartFirstCity, StartRelease } from '@hcm/shared';

import type { Clock } from '../app/ports.js';
import { GoogleApiError, isGoogleFailure } from '../google/failure.js';
import { adoptedConfig, preparedBytes, prepareFile, type FileTools, type PreparedFile } from './files.js';
import { START_RELEASE_LABEL, type LiveRelease, type OwnProject, type StartGoogle } from './google.js';

export const START_STEPS = ['project', 'firebase', 'webApp', 'site', 'files', 'release'] as const;

export type StartStepId = (typeof START_STEPS)[number];

export interface DeployPlan {
    readonly projectId: string;
    readonly displayName: string;
    readonly create: boolean;
    readonly city: StartFirstCity;
}

export interface DeployDeps {
    readonly google: StartGoogle;
    readonly tools: FileTools;
    readonly clock: Pick<Clock, 'setTimeout'>;
    /** The start site's base URL, where `release/<slug>/` is. */
    readonly baseUrl: string;
    readonly release: StartRelease;
    /** A step began. */
    readonly onStep: (step: StartStepId) => void;
    /** `done` of `total` files are ready. */
    readonly onFiles: (done: number, total: number) => void;
}

/** Hosting's limit per `populateFiles` request (the REST deploy guide). */
const POPULATE_BATCH = 1000;
/** How many files are prepared or uploaded at a time: a phone's memory and the browser's connection limit. */
const PARALLEL = 6;
/** The default site can take minutes to appear (§1): this many looks before the page creates it. */
const SITE_LOOKS = 6;
const SITE_WAIT_MS = 5000;
/** The region of every resource of a project (`infra/project.json`). */
const REGION = 'us-central1';

const json = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 4)}\n`);

/** Runs `work` on every item, at most `PARALLEL` at a time, in order of the results. */
async function eachInParallel<Item, Result>(items: readonly Item[], work: (item: Item) => Promise<Result>): Promise<Result[]> {
    const results: Result[] = [];
    let next = 0;
    const lane = async (): Promise<void> => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await work(items[index] as Item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane));
    return results;
}

function sleep(clock: DeployDeps['clock'], ms: number): Promise<void> {
    return new Promise((resolve) => {
        clock.setTimeout(resolve, ms);
    });
}

/**
 * The project, or null when it is not this account's yet. Google answers 403 for a project the caller cannot see "regardless of
 * whether or not it exists" (AIP-193), so for a new project a refusal says nothing: the create's own answer decides, 409 for a
 * taken id and 403 for the terms. For a picked project it stays a refusal.
 */
async function readProject(deps: DeployDeps, plan: DeployPlan): Promise<OwnProject | null> {
    try {
        return await deps.google.getProject(plan.projectId);
    } catch (error) {
        if (plan.create && isGoogleFailure(error, 'forbidden')) {
            return null;
        }
        throw error;
    }
}

async function ensureProject(deps: DeployDeps, plan: DeployPlan): Promise<string> {
    const found = await readProject(deps, plan);
    if (found !== null) {
        return found.projectNumber;
    }
    if (!plan.create) {
        throw new GoogleApiError('resource-manager.getProject', { kind: 'forbidden', status: 403 });
    }
    await deps.google.createProject(plan.projectId, plan.displayName);
    const created = await readProject(deps, plan);
    return created?.projectNumber ?? '';
}

async function ensureFirebase(deps: DeployDeps, projectId: string): Promise<void> {
    if (!(await deps.google.hasFirebase(projectId))) {
        await deps.google.addFirebase(projectId);
    }
}

async function ensureWebApp(deps: DeployDeps, plan: DeployPlan): Promise<void> {
    if (!(await deps.google.hasWebApp(plan.projectId))) {
        await deps.google.createWebApp(plan.projectId, plan.displayName);
    }
}

/** The default site, waiting for it, else made. */
async function ensureSite(deps: DeployDeps, projectId: string): Promise<string> {
    for (let look = 1; look <= SITE_LOOKS; look += 1) {
        const site = await deps.google.defaultSite(projectId);
        if (site !== null) {
            return site;
        }
        if (look < SITE_LOOKS) {
            await sleep(deps.clock, SITE_WAIT_MS);
        }
    }
    return deps.google.createSite(projectId);
}

/**
 * The project's own file: `github` stays out (CR-M5-7), the city is what New city opens with (§8). `viewerOrigins` are the
 * project's two Hosting origins, which are also the server's own default.
 */
function projectFile(plan: DeployPlan, projectNumber: string): Uint8Array {
    return json({
        projectId: plan.projectId,
        projectNumber,
        region: REGION,
        cities: [plan.city.id],
        viewerOrigins: [`https://${plan.projectId}.web.app`, `https://${plan.projectId}.firebaseapp.com`],
        firstCity: plan.city,
    });
}

async function prepareAll(deps: DeployDeps, plan: DeployPlan, projectNumber: string): Promise<PreparedFile[]> {
    const { release } = deps;
    const total = release.files.length + 1;
    let done = 0;
    const counted = (file: PreparedFile): PreparedFile => {
        done += 1;
        deps.onFiles(done, total);
        return file;
    };
    const tree = await eachInParallel(release.files, async (file) =>
        counted(await prepareFile(deps.tools, { baseUrl: deps.baseUrl, slug: release.slug }, file, plan.projectId)),
    );
    return [...tree, counted(await preparedBytes(deps.tools, 'admin/project.json', projectFile(plan, projectNumber)))];
}

async function upload(deps: DeployDeps, uploadUrl: string, file: PreparedFile, token: () => string | null): Promise<void> {
    const response = await deps.tools
        .fetch(`${uploadUrl}/${file.hash}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token() ?? ''}`, 'content-type': 'application/octet-stream' },
            body: file.gzipped as Uint8Array<ArrayBuffer>,
        })
        .catch(() => null);
    if (response === null) {
        throw new GoogleApiError('firebase-hosting.upload', { kind: 'unavailable', status: 0, host: new URL(uploadUrl).host });
    }
    if (!response.ok) {
        const kind = response.status === 401 ? 'unauthorized' : 'unavailable';
        throw new GoogleApiError('firebase-hosting.upload', { kind, status: response.status });
    }
}

function batches<Item>(items: readonly Item[], size: number): Item[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, (index + 1) * size));
}

/** `populateFiles` per batch, then every hash Hosting does not have yet: one upload per distinct content. */
async function uploadAll(deps: DeployDeps, version: string, files: readonly PreparedFile[], token: () => string | null): Promise<void> {
    const byHash = new Map(files.map((file) => [file.hash, file]));
    for (const batch of batches(files, POPULATE_BATCH)) {
        const answer = await deps.google.populate(version, Object.fromEntries(batch.map((file) => [file.path, file.hash])));
        const required = answer.required.flatMap((hash) => {
            const file = byHash.get(hash);
            return file === undefined ? [] : [file];
        });
        await eachInParallel(required, (file) => upload(deps, answer.uploadUrl, file, token));
    }
}

/**
 * Whether what is live stays (§7): this very release, or anything on a project the owner asked to make, which can only be an
 * earlier run of theirs, published since or not. A project picked from a list was warned about (`start.plan.pickWarning`).
 */
function keepsLive(live: LiveRelease | null, plan: DeployPlan, slug: string): boolean {
    return live !== null && (plan.create || live.label === slug);
}

/** Everything; throws the step's failure, and a second call continues from what exists. */
export async function deployStart(deps: DeployDeps, plan: DeployPlan, token: () => string | null): Promise<void> {
    const { google, release, onStep } = deps;
    onStep('project');
    const projectNumber = await ensureProject(deps, plan);
    onStep('firebase');
    await ensureFirebase(deps, plan.projectId);
    onStep('webApp');
    await ensureWebApp(deps, plan);
    onStep('site');
    const site = await ensureSite(deps, plan.projectId);
    if (keepsLive(await google.liveRelease(site), plan, release.slug)) {
        onStep('release');
        return;
    }
    onStep('files');
    const files = await prepareAll(deps, plan, projectNumber);
    const version = await google.createVersion(site, adoptedConfig(release.hosting, plan.projectId), {
        [START_RELEASE_LABEL]: release.slug,
    });
    await uploadAll(deps, version, files, token);
    onStep('release');
    await google.finalize(version);
    await google.release(site, version);
}
