import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    checkManifest,
    configFromAttributes,
    fetchManifestJson,
    loadManifest,
    MANIFEST_RETRY_DELAYS_MS,
    MANIFEST_TIMEOUT_MS,
    readConfig,
    type ManifestFetch,
} from '../../src/config/load.js';
import { manifest } from '../core/fixtures.js';
import { jsonResponse } from '../core/support.js';

const URL_ = 'https://storage.example.org/cities/bucuresti/manifest.json';
const noSleep = (): Promise<void> => Promise.resolve();

function scripted(...answers: (Response | Error)[]): ManifestFetch & { readonly calls: string[] } {
    const calls: string[] = [];
    const fetch = (url: string): Promise<Response> => {
        calls.push(url);
        const answer = answers.shift() ?? new Error('no more answers');
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    };
    return Object.assign(fetch, { calls });
}

describe('embed configuration', () => {
    it('happyPath_aValidConfigPasses', () => {
        expect(readConfig({ cityId: 'bucuresti', manifestUrl: URL_, lang: 'en' }, 'ro')).toEqual({
            ok: true,
            value: { cityId: 'bucuresti', manifestUrl: URL_, lang: 'en' },
        });
    });

    it('badPath_aMissingConfigSaysSo', () => {
        expect(readConfig(undefined, 'ro')).toEqual({ ok: false, error: { code: 'error.config.missing', retryable: false } });
        expect(readConfig(null, 'en')).toEqual({ ok: false, error: { code: 'error.config.missing', retryable: false } });
    });

    it('badPath_anInvalidConfigNamesItsFirstIssueInTheVisitorsLanguage', () => {
        expect(readConfig({ manifestUrl: URL_, colour: 'red' }, 'en')).toEqual({
            ok: false,
            error: { code: 'error.config.invalid', retryable: false, params: { detail: 'colour: The field is not known.' } },
        });
        const both = readConfig({ manifestUrl: URL_, manifest: {} }, 'ro');
        expect(both.ok ? '' : both.error.params?.['detail']).toMatch(/^config: /);
    });

    it('happyPath_elementAttributesAndTheManifestProperty', () => {
        const fromAttributes = configFromAttributes(
            { manifestUrl: URL_, cityId: 'bucuresti', lang: null, engineBase: '' },
            undefined,
            'ro',
        );
        const inline = configFromAttributes({}, { version: 1 }, 'ro');

        expect(fromAttributes).toEqual({ ok: true, value: { manifestUrl: URL_, cityId: 'bucuresti' } });
        expect(inline).toEqual({ ok: true, value: { manifest: { version: 1 } } });
    });

    it('badPath_anElementWithoutASourceIsInvalid', () => {
        const result = configFromAttributes({ cityId: 'bucuresti' }, null, 'ro');

        expect(result.ok ? null : result.error.code).toBe('error.config.invalid');
    });
});

describe('manifest checks', () => {
    it('happyPath_aValidManifestOfTheConfiguredCity', () => {
        const result = checkManifest(manifest(), { manifestUrl: URL_, cityId: 'bucuresti' }, '1.0.0');

        expect(result.ok && result.value.city.id).toBe('bucuresti');
    });

    it('badPath_anotherGenerationIsRefusedBeforeTheSchema', () => {
        expect(checkManifest({ version: 2 }, { manifestUrl: URL_ }, '1.0.0')).toEqual({
            ok: false,
            error: { code: 'error.manifest.version', retryable: false },
        });
    });

    it('badPath_anInvalidManifestCountsItsIssuesAndNamesTheFirst', () => {
        const result = checkManifest({ ...manifest(), layers: 'none' }, { manifestUrl: URL_ }, '1.0.0');

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'error.manifest.invalid',
                retryable: false,
                params: { count: '1', detail: 'layers validation.type', issuePath: 'layers', issueCode: 'validation.type' },
            },
        });
    });
});

describe('manifest fetch', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_fetchesValidatesAndReturnsTheManifest', async () => {
        const fetch = scripted(jsonResponse(manifest()));

        const result = await loadManifest({ manifestUrl: URL_ }, { fetch, engineVersion: '1.0.0' });

        expect(result.ok && result.value.photos).toHaveLength(3);
        expect(fetch.calls).toEqual([URL_]);
    });

    it('happyPath_anInlineManifestIsCheckedWithoutAFetch', async () => {
        const fetch = scripted();

        const result = await loadManifest({ manifest: manifest() }, { fetch, engineVersion: '1.0.0' });

        expect(result.ok).toBe(true);
        expect(fetch.calls).toEqual([]);
    });

    it('badPath_a404IsNotFoundAndNotRetried', async () => {
        const fetch = scripted(jsonResponse({}, 404));

        const result = await fetchManifestJson(URL_, { fetch, engineVersion: '1.0.0', sleep: noSleep });

        expect(result).toEqual({ ok: false, error: { code: 'error.manifest.notFound', retryable: true, params: { detail: '404' } } });
        expect(fetch.calls).toHaveLength(1);
    });

    it('happyPath_aNetworkErrorAndA503AreRetriedThenSucceed', async () => {
        const fetch = scripted(new TypeError('Failed to fetch'), jsonResponse({}, 503), jsonResponse({ version: 1 }));
        const waits: number[] = [];

        const sleep = (ms: number): Promise<void> => {
            waits.push(ms);
            return Promise.resolve();
        };

        const result = await fetchManifestJson(URL_, { fetch, engineVersion: '1.0.0', sleep });

        expect(result).toEqual({ ok: true, value: { version: 1 } });
        expect(waits).toEqual([...MANIFEST_RETRY_DELAYS_MS]);
    });

    it('badPath_retriesStopAfterTheLastAttempt', async () => {
        const fetch = scripted(jsonResponse({}, 500), jsonResponse({}, 502), jsonResponse({}, 429));

        const result = await fetchManifestJson(URL_, { fetch, engineVersion: '1.0.0', sleep: noSleep });

        expect(result).toEqual({ ok: false, error: { code: 'error.manifest.network', retryable: true, params: { detail: '429' } } });
        expect(fetch.calls).toHaveLength(3);
    });

    it('badPath_aClientErrorIsNotRetried', async () => {
        const fetch = scripted(jsonResponse({}, 403));

        const result = await fetchManifestJson(URL_, { fetch, engineVersion: '1.0.0', sleep: noSleep, retryDelaysMs: [1, 1, 1] });

        expect(result.ok ? null : result.error.params).toEqual({ detail: '403' });
        expect(fetch.calls).toHaveLength(1);
    });

    it('badPath_aBodyThatIsNotJsonIsAnInvalidManifest', async () => {
        const fetch = scripted(new Response('<html>oops</html>', { status: 200 }));

        const result = await loadManifest({ manifestUrl: URL_ }, { fetch, engineVersion: '1.0.0' });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'error.manifest.invalid',
                retryable: false,
                params: { count: '1', detail: 'validation.json', issuePath: '', issueCode: 'validation.json' },
            },
        });
    });

    it('badPath_aSlowServerTimesOutWithoutARetry', async () => {
        vi.useFakeTimers();
        let calls = 0;
        const fetch: ManifestFetch = (_url, init) => {
            calls += 1;
            return new Promise<Response>((_resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    reject(new DOMException('aborted', 'AbortError'));
                });
            });
        };

        const pending = fetchManifestJson(URL_, { fetch, engineVersion: '1.0.0' });
        await vi.advanceTimersByTimeAsync(MANIFEST_TIMEOUT_MS);

        expect(await pending).toEqual({ ok: false, error: { code: 'error.manifest.timeout', retryable: true } });
        expect(calls).toBe(1);
    });

    it('happyPath_theDefaultWaitIsARealDelay', async () => {
        vi.useFakeTimers();
        const fetch = scripted(new TypeError('offline'), jsonResponse({ version: 1 }));

        const pending = fetchManifestJson(URL_, { fetch, engineVersion: '1.0.0', timeoutMs: 100 });
        await vi.advanceTimersByTimeAsync((MANIFEST_RETRY_DELAYS_MS[0] ?? 0) + 1);

        expect(await pending).toEqual({ ok: true, value: { version: 1 } });
    });
});
