import { createFakeFetch, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { loadRuntime, loadWebConfig, RUNTIME_URL, UNKNOWN_RELEASE, WEB_CONFIG_URL } from '../../src/app/config.js';
import { E2E_WEB_CONFIG } from './fakes.js';

function serving(files: Readonly<Record<string, Response>>) {
    return createFakeFetch((request) => {
        const response = files[request.url.pathname];
        return response === undefined ? undefined : { operation: request.url.pathname, response };
    });
}

describe('loadWebConfig', () => {
    it('happyPath_readsHostingsReservedFileAndDropsUnknownKeys', async () => {
        const fetcher = serving({ [WEB_CONFIG_URL]: jsonResponse({ ...E2E_WEB_CONFIG, locationId: 'us-central', databaseURL: 'x' }) });

        await expect(loadWebConfig((url, init) => fetcher.fetch(`https://demo-hcm.web.app${url}`, init))).resolves.toEqual(E2E_WEB_CONFIG);
        expect(fetcher.calls[0]?.url).toBe('https://demo-hcm.web.app/__/firebase/init.json');
    });

    it('badPath_aMissingInvalidOrUnreachableFileIsNoConfiguration', async () => {
        const missing = serving({});
        const invalid = serving({ [WEB_CONFIG_URL]: jsonResponse({ ...E2E_WEB_CONFIG, projectId: 'Not A Project' }) });
        const notFound = serving({ [WEB_CONFIG_URL]: new Response('nope', { status: 404 }) });
        const at = (fetcher: ReturnType<typeof serving>) => (url: string, init?: RequestInit) =>
            fetcher.fetch(`https://h.test${url}`, init);

        await expect(loadWebConfig(at(missing))).resolves.toBeNull();
        await expect(loadWebConfig(at(invalid))).resolves.toBeNull();
        await expect(loadWebConfig(at(notFound))).resolves.toBeNull();
    });
});

describe('loadRuntime', () => {
    it('happyPath_theDeployNamesTheReleaseAndTheAppCheckKey', async () => {
        const fetcher = serving({ [RUNTIME_URL]: jsonResponse({ release: 'abc123', appCheckSiteKey: '6Le2e-site-key-0001' }) });

        await expect(loadRuntime((url) => fetcher.fetch(`https://h.test${url}`))).resolves.toEqual({
            release: 'abc123',
            appCheckSiteKey: '6Le2e-site-key-0001',
        });
    });

    it('happyPath_theBuildTimeComesWithTheRelease_badPath_oneThatIsNotWholeSecondsMakesNoRuntime', async () => {
        // Finding 39 of 2026-11-01: the build time orders two builds of one version.
        const timed = serving({ [RUNTIME_URL]: jsonResponse({ release: '1.0.0+457201e', releaseTime: 1_761_990_000 }) });
        const broken = serving({ [RUNTIME_URL]: jsonResponse({ release: '1.0.0+457201e', releaseTime: 'yesterday' }) });

        await expect(loadRuntime((url) => timed.fetch(`https://h.test${url}`))).resolves.toEqual({
            release: '1.0.0+457201e',
            releaseTime: 1_761_990_000,
        });
        await expect(loadRuntime((url) => broken.fetch(`https://h.test${url}`))).resolves.toEqual({ release: UNKNOWN_RELEASE });
    });

    it('happyPath_aStartUpDeploySaysSo', async () => {
        const fetcher = serving({ [RUNTIME_URL]: jsonResponse({ release: '0.0.0+5d02329', startUp: true }) });

        await expect(loadRuntime((url) => fetcher.fetch(`https://h.test${url}`))).resolves.toEqual({
            release: '0.0.0+5d02329',
            startUp: true,
        });
    });

    it('badPath_withoutAFileTheReleaseIsDevAndThereIsNoAppCheck', async () => {
        const fetcher = serving({ [RUNTIME_URL]: jsonResponse({ release: '' }) });

        await expect(loadRuntime((url) => fetcher.fetch(`https://h.test${url}`))).resolves.toEqual({ release: UNKNOWN_RELEASE });
        await expect(loadRuntime(() => Promise.reject(new Error('offline')))).resolves.toEqual({ release: UNKNOWN_RELEASE });
    });
});
