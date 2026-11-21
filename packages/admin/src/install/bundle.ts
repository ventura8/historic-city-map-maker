/**
 * The admin's own install bundle (`docs/research/M6-interfaces.md` §1.3): `install/<slug>/manifest.json` below the
 * admin's base path, from the admin's own origin. The admin reads it when the owner clicks, refuses it unless it is
 * this admin's (its format, its release and build time, its project), and computes its SHA-256, which the build's `fetch` step checks
 * before it uses a byte of the bundle. The origin must be one of the project's Hosting origins: never a value from data.
 */
import {
    INSTALL_FOLDER,
    GENERIC_INSTALL_PROJECT,
    INSTALL_FORMAT,
    INSTALL_MANIFEST_FILE,
    installManifestSchema,
    installReleaseSlug,
    RELEASE_PATTERN,
    adminSiteId,
    siteOrigins,
    type ApiErrorCode,
    type InstallManifest,
} from '@hcm/shared';

import { isRecord } from '../google/json.js';

export interface InstallBundle {
    readonly manifest: InstallManifest;
    /** SHA-256 (hex) of `manifest.json`'s bytes as the admin read them. */
    readonly sha256: string;
    /** The admin's own origin and base path, where the build fetches the bundle from. */
    readonly origin: string;
    readonly basePath: string;
}

/** Why the bundle cannot be used: an `apiError.install.*` code (or `apiError.unavailable`, which may pass). */
export class InstallBundleError extends Error {
    readonly code: ApiErrorCode;
    /** The message's placeholders (`apiError.install.adminOutdated`'s newer release), when it has any. */
    readonly params: Readonly<Record<string, string>> | undefined;

    constructor(code: ApiErrorCode, params?: Readonly<Record<string, string>>) {
        super(code);
        this.name = 'InstallBundleError';
        this.code = code;
        this.params = params;
    }

    /** The card's message: the code and its placeholders. */
    notice(): { readonly key: ApiErrorCode; readonly params?: Readonly<Record<string, string>> } {
        return this.params === undefined ? { key: this.code } : { key: this.code, params: this.params };
    }
}

export interface BundleDeps {
    readonly fetch: typeof fetch;
    /** The admin's absolute base URL (`https://<project>.web.app/admin/`). */
    readonly baseUrl: string;
    /** The admin's `runtime.json` release. */
    readonly release: string;
    /** Its build time (`runtime.json`'s `releaseTime`, finding 39 of 2026-11-01), or null when the build knows none. */
    readonly releaseTime: number | null;
    /** The web configuration's project. */
    readonly projectId: string;
    /** The origins the admin may install from (the project's Hosting origins; the e2e world's own). */
    readonly origins: readonly string[];
    /** SHA-256 of `bytes` as lowercase hex (`crypto.subtle` in the browser). */
    readonly digest: (bytes: ArrayBuffer) => Promise<string>;
}

/**
 * Where the admin is served (§1.3): `https://<project>.web.app`, `https://<project>.firebaseapp.com`, and the admin's own
 * site's two (`<project>-admin`, §210).
 */
export function hostingOrigins(projectId: string): readonly string[] {
    return [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`, ...siteOrigins(adminSiteId(projectId))];
}

/** The bundle folder's address below the admin's base URL. */
export function bundleFolderUrl(baseUrl: string, release: string): URL {
    return new URL(`${INSTALL_FOLDER}/${installReleaseSlug(release)}/`, baseUrl);
}

/** SHA-256 of `bytes` as lowercase hex with Web Crypto. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseJson(bytes: ArrayBuffer): unknown {
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        // Hosting answers a missing file under /admin/ with the admin's page: no JSON means no bundle.
        throw new InstallBundleError('apiError.install.bundleMissing');
    }
}

async function readManifest(deps: BundleDeps, url: URL): Promise<ArrayBuffer> {
    let response: Response;
    try {
        response = await deps.fetch(url, { cache: 'no-store' });
    } catch {
        throw new InstallBundleError('apiError.unavailable');
    }
    if (response.status === 404) {
        throw new InstallBundleError('apiError.install.bundleMissing');
    }
    if (!response.ok) {
        throw new InstallBundleError('apiError.unavailable');
    }
    return response.arrayBuffer();
}

/** The manifest when it has this admin's format, else `apiError.install.bundleFormat`. */
function parsedManifest(json: unknown): InstallManifest {
    const parsed = isRecord(json) && json['format'] === INSTALL_FORMAT ? installManifestSchema.safeParse(json) : null;
    if (parsed?.success !== true) {
        throw new InstallBundleError('apiError.install.bundleFormat');
    }
    return parsed.data;
}

/** The manifest when it is this admin's, else the reason it is not. */
function checkedManifest(deps: BundleDeps, json: unknown): InstallManifest {
    const manifest = parsedManifest(json);
    const sameRelease = manifest.release === deps.release && manifest.releaseTime === deps.releaseTime;
    // M14: a bundle made for no project in particular fits any (`docs/research/M14-start-your-map.md` §6).
    const sameProject = manifest.projectId === deps.projectId || manifest.projectId === GENERIC_INSTALL_PROJECT;
    if (!sameRelease || !sameProject) {
        throw new InstallBundleError('apiError.install.mismatch');
    }
    return manifest;
}

/** Reads and checks the admin's own bundle; throws an {@link InstallBundleError} when it cannot be used. */
export async function loadInstallBundle(deps: BundleDeps): Promise<InstallBundle> {
    if (!RELEASE_PATTERN.test(deps.release)) {
        throw new InstallBundleError('apiError.install.noRelease');
    }
    const base = new URL(deps.baseUrl);
    if (!deps.origins.includes(base.origin)) {
        throw new InstallBundleError('apiError.install.mismatch');
    }
    const bytes = await readManifest(deps, new URL(INSTALL_MANIFEST_FILE, bundleFolderUrl(deps.baseUrl, deps.release)));
    const manifest = checkedManifest(deps, parseJson(bytes));
    return { manifest, sha256: await deps.digest(bytes), origin: base.origin, basePath: base.pathname };
}

/**
 * `load` once it succeeded: the bundle of a release never changes, so it is read once a session; a failure (a missing
 * file, the network) is not kept, and the next call reads again.
 */
export function bundleOnce(load: () => Promise<InstallBundle>): () => Promise<InstallBundle> {
    let found: Promise<InstallBundle> | null = null;
    return () => {
        found ??= load().catch((error: unknown) => {
            found = null;
            throw error;
        });
        return found;
    };
}
