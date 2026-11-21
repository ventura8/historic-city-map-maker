/**
 * Boot input (docs/ENGINE_API.md → config.js, Errors and validation): the embed configuration from
 * `window.HistoricCityMapConfig` or the element's attributes, and the City Manifest, inline or fetched with a timeout
 * and a retry. Every failure is a `ViewerError` whose code is an i18n key, so the error card is localized; `detail`
 * params are non-localized hints (an issue path, an HTTP status) for the city owner.
 */
import {
    checkManifestCompat,
    engineConfigSchema,
    translate,
    validate,
    validateManifest,
    type EngineConfig,
    type ViewerLocale,
    type Manifest,
    type ValidationIssue,
} from '@hcm/shared';

import type { ViewerError } from '../core/state.js';

/** A manifest request that has not answered by then fails with `error.manifest.timeout` (V01). */
export const MANIFEST_TIMEOUT_MS = 15_000;

/** Waits before the second and third attempt after a network error or a 5xx (a timeout is not retried). */
export const MANIFEST_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ViewerError };

export type ManifestFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;

export interface ManifestLoadOptions {
    readonly fetch: ManifestFetch;
    /** `ENGINE_VERSION`, compared with the manifest's `city.engine.minVersion`. */
    readonly engineVersion: string;
    readonly timeoutMs?: number;
    readonly retryDelaysMs?: readonly number[];
    readonly sleep?: (ms: number) => Promise<void>;
}

function fail<T>(code: ViewerError['code'], retryable: boolean, params?: Readonly<Record<string, string>>): Result<T> {
    return { ok: false, error: params === undefined ? { code, retryable } : { code, retryable, params } };
}

/** The first issue as `path: message` in the visitor's language. */
function issueDetail(issues: readonly ValidationIssue[], locale: ViewerLocale): string {
    return issues
        .slice(0, 1)
        .map((issue) => `${issue.path === '' ? 'config' : issue.path}: ${translate(locale, issue.code)}`)
        .join('');
}

/** `window.HistoricCityMapConfig` (or any embed configuration) validated; absent is `error.config.missing`. */
export function readConfig(input: unknown, locale: ViewerLocale): Result<EngineConfig> {
    if (input === undefined || input === null) {
        return fail('error.config.missing', false);
    }
    const result = validate(engineConfigSchema, input);
    return result.ok
        ? { ok: true, value: result.value }
        : fail('error.config.invalid', false, { detail: issueDetail(result.issues, locale) });
}

export interface ConfigAttributes {
    readonly manifestUrl?: string | null;
    readonly cityId?: string | null;
    readonly lang?: string | null;
    readonly engineBase?: string | null;
}

/** The configuration of a `<hcm-map-viewer>`: its attributes plus the `manifest` property (absent ones left out). */
export function configFromAttributes(attributes: ConfigAttributes, manifest: unknown, locale: ViewerLocale): Result<EngineConfig> {
    const present = Object.entries(attributes).filter(([, value]) => typeof value === 'string' && value !== '');
    const input = manifest === undefined || manifest === null ? Object.fromEntries(present) : { ...Object.fromEntries(present), manifest };
    return readConfig(input, locale);
}

function compatFailure(compat: Exclude<ReturnType<typeof checkManifestCompat>, { readonly ok: true }>): Result<Manifest> {
    return compat.code === 'error.manifest.version' ? fail(compat.code, false) : fail(compat.code, false, { version: compat.minVersion });
}

/**
 * `error.manifest.invalid` with the issue count, the first issue as a non-localized `detail` (the `hcm-error` hint) and
 * as `issuePath` / `issueCode`, which the error card shows in the visitor's language so the city owner sees what to fix.
 */
function invalidFailure(issues: readonly ValidationIssue[]): Result<Manifest> {
    const [first] = issues;
    const issue = first === undefined ? {} : { detail: `${first.path} ${first.code}`, issuePath: first.path, issueCode: first.code };
    return fail('error.manifest.invalid', false, { count: String(issues.length), ...issue });
}

function matchCity(config: EngineConfig, manifest: Manifest): Result<Manifest> {
    const cityId = config.cityId;
    return cityId === undefined || cityId === manifest.city.id
        ? { ok: true, value: manifest }
        : fail('error.config.cityMismatch', false, { cityId, manifestCityId: manifest.city.id });
}

/** Compatibility, then the strict schema, then the configured city (docs/ENGINE_API.md → Errors and validation). */
export function checkManifest(input: unknown, config: EngineConfig, engineVersion: string): Result<Manifest> {
    const compat = checkManifestCompat(input, engineVersion);
    if (!compat.ok) {
        return compatFailure(compat);
    }
    const result = validateManifest(input);
    return result.ok ? matchCity(config, result.value) : invalidFailure(result.issues);
}

type Attempt = Result<unknown> & { readonly retry?: boolean };

function statusFailure(status: number): Attempt {
    if (status === 404 || status === 410) {
        return fail('error.manifest.notFound', true, { detail: String(status) });
    }
    return { ...fail('error.manifest.network', true, { detail: String(status) }), retry: status >= 500 || status === 429 };
}

async function readJson(response: Response): Promise<Attempt> {
    try {
        return { ok: true, value: JSON.parse(await response.text()) as unknown };
    } catch {
        return fail('error.manifest.invalid', false, {
            count: '1',
            detail: 'validation.json',
            issuePath: '',
            issueCode: 'validation.json',
        });
    }
}

async function fetchOnce(url: string, options: ManifestLoadOptions): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, options.timeoutMs ?? MANIFEST_TIMEOUT_MS);
    try {
        const response = await options.fetch(url, { signal: controller.signal });
        return response.ok ? await readJson(response) : statusFailure(response.status);
    } catch {
        return controller.signal.aborted ? fail('error.manifest.timeout', true) : { ...fail('error.manifest.network', true), retry: true };
    } finally {
        clearTimeout(timer);
    }
}

const defaultSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/** The manifest JSON at `url`: retried after a network error or a 5xx, never after a 404 or a timeout. */
export async function fetchManifestJson(url: string, options: ManifestLoadOptions): Promise<Result<unknown>> {
    const sleep = options.sleep ?? defaultSleep;
    let attempt = await fetchOnce(url, options);
    for (const delay of options.retryDelaysMs ?? MANIFEST_RETRY_DELAYS_MS) {
        if (attempt.retry !== true) {
            break;
        }
        await sleep(delay);
        attempt = await fetchOnce(url, options);
    }
    return withoutRetry(attempt);
}

function withoutRetry(attempt: Attempt): Result<unknown> {
    return attempt.ok ? { ok: true, value: attempt.value } : { ok: false, error: attempt.error };
}

/** The validated manifest of `config`: the inline one, or the one at `manifestUrl`. */
export async function loadManifest(config: EngineConfig, options: ManifestLoadOptions): Promise<Result<Manifest>> {
    if (config.manifestUrl === undefined) {
        return checkManifest(config.manifest, config, options.engineVersion);
    }
    const json = await fetchManifestJson(config.manifestUrl, options);
    return json.ok ? checkManifest(json.value, config, options.engineVersion) : json;
}
