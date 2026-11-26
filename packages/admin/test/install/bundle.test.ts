import { createHash } from 'node:crypto';

import { createFakeFetch, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it, vi } from 'vitest';

import { installManifest as e2eManifest, RELEASE, RELEASE_TIME } from './world.js';
import {
    bundleFolderUrl,
    bundleOnce,
    hostingOrigins,
    InstallBundleError,
    loadInstallBundle,
    sha256Hex,
    type BundleDeps,
    type InstallBundle,
} from '../../src/install/bundle.js';

/**
 * The admin's own install bundle (`docs/research/M6-interfaces.md` §1.3): read from its own origin below its base
 * path, refused unless it is this admin's (format, release, project), and hashed for the build's `fetch` step.
 */

const BASE = 'https://demo-hcm.web.app/admin/';

function deps(answer: (url: URL) => Response | undefined, changes: Partial<BundleDeps> = {}) {
    const fake = createFakeFetch((request) => {
        const response = answer(request.url);
        return response === undefined ? undefined : { operation: 'bundle', response };
    });
    const bundleDeps: BundleDeps = {
        fetch: fake.fetch,
        baseUrl: BASE,
        release: RELEASE,
        releaseTime: RELEASE_TIME,
        projectId: 'demo-hcm',
        origins: hostingOrigins('demo-hcm'),
        digest: sha256Hex,
        ...changes,
    };
    return { fake, bundleDeps };
}

function code(error: unknown): string {
    return error instanceof InstallBundleError ? error.code : String(error);
}

describe('loadInstallBundle', () => {
    it('happyPath_theAdminsOwnManifestIsReadFromItsBaseAndHashed', async () => {
        const text = JSON.stringify(e2eManifest());
        const { fake, bundleDeps } = deps((url) => (url.pathname.endsWith('/manifest.json') ? new Response(text) : undefined));

        const bundle = await loadInstallBundle(bundleDeps);

        expect(bundle.sha256).toBe(createHash('sha256').update(text).digest('hex'));
        expect({ origin: bundle.origin, basePath: bundle.basePath, release: bundle.manifest.release }).toEqual({
            origin: 'https://demo-hcm.web.app',
            basePath: '/admin/',
            release: RELEASE,
        });
        expect(fake.calls[0]?.url).toBe('https://demo-hcm.web.app/admin/install/1-0-0-abc1234/manifest.json');
    });

    it.each([
        ['a release that does not parse', { release: 'e2e' }, 'apiError.install.noRelease'],
        ['an origin that is not the projects', { baseUrl: 'https://elsewhere.example/admin/' }, 'apiError.install.mismatch'],
    ])('badPath_%s is refused before any request', async (_name, changes, expected) => {
        const { fake, bundleDeps } = deps(() => jsonResponse(e2eManifest()), changes);

        await expect(loadInstallBundle(bundleDeps).catch(code)).resolves.toBe(expected);
        expect(fake.calls).toHaveLength(0);
    });

    it.each([
        ['no file (404)', () => new Response('missing', { status: 404 }), 'apiError.install.bundleMissing'],
        [
            'the admin page instead (Hosting rewrites a missing file)',
            () => new Response('<!doctype html>'),
            'apiError.install.bundleMissing',
        ],
        ['a server error', () => new Response('boom', { status: 503 }), 'apiError.unavailable'],
        ['another format', () => jsonResponse(e2eManifest({ format: 2 })), 'apiError.install.bundleFormat'],
        ['a broken manifest', () => jsonResponse(e2eManifest({ functions: [] })), 'apiError.install.bundleFormat'],
        [
            'another release',
            () => jsonResponse(e2eManifest({ release: '1.0.1+abc1234', slug: '1-0-1-abc1234' })),
            'apiError.install.mismatch',
        ],
        ['another project', () => jsonResponse(e2eManifest({ projectId: 'other-project' })), 'apiError.install.mismatch'],
        // Finding 39 of 2026-11-01: a manifest of another build time is another build of the release.
        ['another build time', () => jsonResponse(e2eManifest({ releaseTime: 1 })), 'apiError.install.mismatch'],
        ['an array', () => jsonResponse([]), 'apiError.install.bundleFormat'],
    ])('badPath_%s cannot be installed', async (_name, answer, expected) => {
        const { bundleDeps } = deps(answer);

        await expect(loadInstallBundle(bundleDeps).catch(code)).resolves.toBe(expected);
    });

    it('badPath_aNetworkFailureIsUnavailable', async () => {
        const { bundleDeps } = deps(() => undefined, { fetch: () => Promise.reject(new TypeError('offline')) });

        await expect(loadInstallBundle(bundleDeps).catch(code)).resolves.toBe('apiError.unavailable');
    });
});

describe('the bundle helpers', () => {
    it('happyPath_theProjectsHostingOriginsAndTheFolderOfARelease', () => {
        expect(hostingOrigins('demo-hcm')).toEqual([
            'https://demo-hcm.web.app',
            'https://demo-hcm.firebaseapp.com',
            'https://demo-hcm-admin.web.app',
            'https://demo-hcm-admin.firebaseapp.com',
        ]);
        expect(bundleFolderUrl(BASE, RELEASE).toString()).toBe('https://demo-hcm.web.app/admin/install/1-0-0-abc1234/');
    });

    it('happyPath_aFoundBundleIsReadOnce_badPath_aFailureIsReadAgain', async () => {
        const found = { sha256: 'x' } as unknown as InstallBundle;
        const load = vi.fn<() => Promise<InstallBundle>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(found);
        const once = bundleOnce(load);

        await expect(once()).rejects.toThrow('offline');
        await expect(once()).resolves.toBe(found);
        await expect(once()).resolves.toBe(found);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('happyPath_sha256IsLowercaseHex', async () => {
        await expect(sha256Hex(new TextEncoder().encode('abc').buffer)).resolves.toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });
});
