import type { Logger } from '@hcm/shared';

import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { UsgsApi } from '../ports/usgs-api.js';
import type { UsgsScenes } from '../ports/usgs-scenes.js';
import { at, failureOfStatus, list, readJson, send, stringAt, strings, upstreamError, type Fetch } from './upstream-http.js';

/**
 * USGS M2M (EarthExplorer machine-to-machine) over REST with `fetch` (`.agent/skills/pipeline/usgs_m2m_skill.md`,
 * security review §4.2). The body is read on every status, because M2M answers its own errors as HTTP 500 JSON with an
 * `errorCode`, while the gateway in front of it answers HTML:
 *
 * | Answer | Failure |
 * | --- | --- |
 * | HTML 403 | `unauthorized` (an invalid or expired application token) |
 * | HTML 503 ("Application Offline") | `maintenance` (monthly, often on Wednesdays; retried later, never a hard failure) |
 * | 429, an `errorCode` starting with `RATE_LIMIT` | `rateLimited` |
 * | `AUTH_INVALID`, `AUTH_KEY_INVALID` | `unauthorized` |
 * | `AUTH_UNAUTHORIZED` (and the API's own spelling `AUTH_UNAUTHROIZED`) | `forbidden`: the account has no M2M access yet |
 * | another `errorCode` | `invalid` |
 * | other 5xx, network, timeout | `unavailable` |
 *
 * The application token goes only into the `login-token` body, the API key only into the `X-Auth-Token` header; the
 * error code is logged (it is not secret), the error message is not (it may repeat the username).
 */
export const USGS_M2M_API = 'https://m2m.cr.usgs.gov/api/api/json/stable';

const SERVICE = 'usgs';
const HTML_FAILURES: ReadonlyMap<number, UpstreamFailure> = new Map([
    [403, 'unauthorized'],
    [503, 'maintenance'],
]);
const ERROR_CODES: ReadonlyMap<string, UpstreamFailure> = new Map([
    ['AUTH_INVALID', 'unauthorized'],
    ['AUTH_KEY_INVALID', 'unauthorized'],
    ['AUTH_UNAUTHORIZED', 'forbidden'],
    ['AUTH_UNAUTHROIZED', 'forbidden'],
]);

function errorCodeFailure(code: string): UpstreamFailure {
    return code.startsWith('RATE_LIMIT') ? 'rateLimited' : (ERROR_CODES.get(code) ?? 'invalid');
}

function errorCodeOf(answer: unknown): string | undefined {
    const code = at(answer, 'errorCode');
    return typeof code === 'string' && code !== '' ? code : undefined;
}

/** The failure an M2M answer reports, or undefined for a success (`answer` is undefined when it was not JSON). */
function m2mFailure(response: Response, answer: unknown): UpstreamFailure | undefined {
    if (answer === undefined) {
        return HTML_FAILURES.get(response.status) ?? failureOfStatus(response.status);
    }
    const errorCode = errorCodeOf(answer);
    if (errorCode !== undefined) {
        return errorCodeFailure(errorCode);
    }
    return response.ok ? undefined : failureOfStatus(response.status);
}

export interface UsgsOptions {
    readonly fetch: Fetch;
    readonly log: Logger;
}

/** One M2M request: its endpoint, its body, and (lesson 676) how long it may take. */
interface M2mRequest {
    readonly endpoint: string;
    readonly body: unknown;
    readonly timeoutMs?: number | undefined;
}

/** One M2M call: the `data` of a successful answer, else the failure of the table above. */
async function m2mCall(options: UsgsOptions, call: M2mRequest, apiKey?: string): Promise<unknown> {
    const { endpoint, body } = call;
    const json = { 'content-type': 'application/json' };
    const headers = apiKey === undefined ? json : { ...json, 'x-auth-token': apiKey };
    const timeout = call.timeoutMs === undefined ? {} : { timeoutMs: call.timeoutMs };
    const response = await send(options.fetch, SERVICE, `${USGS_M2M_API}/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...timeout,
    });
    const answer = await readJson(response);
    const failure = m2mFailure(response, answer);
    if (failure !== undefined) {
        options.log.warn('usgs m2m call failed', { endpoint, status: response.status, errorCode: errorCodeOf(answer) });
        throw upstreamError(SERVICE, response, failure);
    }
    return at(answer, 'data');
}

export function createUsgsApi(options: UsgsOptions): UsgsApi {
    const m2m = (endpoint: string, body: unknown, apiKey?: string): Promise<unknown> => m2mCall(options, { endpoint, body }, apiKey);

    return {
        login: async (username, applicationToken) => {
            const apiKey = await m2m('login-token', { username, token: applicationToken });
            if (typeof apiKey !== 'string' || apiKey === '') {
                throw new UpstreamError(SERVICE, 'invalid');
            }
            return apiKey;
        },
        permissions: async (apiKey) => {
            const permissions = await m2m('permissions', {}, apiKey);
            if (!Array.isArray(permissions)) {
                throw new UpstreamError(SERVICE, 'invalid');
            }
            return strings(permissions);
        },
        logout: async (apiKey) => {
            try {
                await m2m('logout', {}, apiKey);
            } catch (error) {
                options.log.debug('usgs logout failed (the key expires by itself)', { error: String(error) });
            }
        },
        request: (apiKey, endpoint, payload) => m2m(endpoint, payload, apiKey),
    };
}

type SceneSearch = Parameters<UsgsScenes['search']>[1];
type SceneRecord = Awaited<ReturnType<UsgsScenes['search']>>['records'][number];
type DownloadOption = Awaited<ReturnType<UsgsScenes['downloadOptions']>>[number];
type DatasetIds = Awaited<ReturnType<UsgsScenes['datasets']>>[number];

/** The outer ring of a `spatialCoverage` polygon: its `[lng, lat]` positions (anything else dropped). */
function ringOf(coordinates: unknown): (readonly [number, number])[] {
    const [outer] = list(coordinates);
    return list(outer).flatMap((position) => {
        const [lng, lat] = list(position);
        return typeof lng === 'number' && typeof lat === 'number' ? [[lng, lat] as const] : [];
    });
}

/** M2M's cloud cover: a number or a numeric string; `-1` (none recorded) and anything unreadable are null. */
function cloudOf(value: unknown): number | null {
    const cover = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
    return Number.isFinite(cover) && cover >= 0 ? cover : null;
}

/** A metadata value as text: strings, numbers and booleans; anything else (null, a structure) is none. */
function fieldText(value: unknown): string | undefined {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

/** The full metadata's `[{fieldName, value}]` as a record of strings (empty values dropped). */
function metadataOf(value: unknown): Record<string, string> {
    return Object.fromEntries(
        list(value).flatMap((field) => {
            const name = stringAt(field, 'fieldName');
            const text = fieldText(at(field, 'value'));
            return name === undefined || text === undefined ? [] : [[name, text]];
        }),
    );
}

/** The first browse image's address, when the result has one. */
function browseOf(entry: unknown): { browseUrl?: string } {
    const browseUrl = stringAt(list(at(entry, 'browse'))[0], 'browsePath');
    return browseUrl === undefined || browseUrl === '' ? {} : { browseUrl };
}

/** One `scene-search` result; one without an entity id or a start date is dropped. */
function toSceneRecord(entry: unknown): SceneRecord[] {
    const entityId = stringAt(entry, 'entityId');
    const startDate = stringAt(entry, 'temporalCoverage', 'startDate');
    if (entityId === undefined || startDate === undefined) {
        return [];
    }
    const record: SceneRecord = {
        entityId,
        displayId: stringAt(entry, 'displayId') ?? entityId,
        acquisitionDate: startDate.slice(0, 10),
        footprint: ringOf(at(entry, 'spatialCoverage', 'coordinates')),
        cloudCover: cloudOf(at(entry, 'cloudCover')),
        downloadAvailable: at(entry, 'options', 'download') === true,
        metadata: metadataOf(at(entry, 'metadata')),
        ...browseOf(entry),
    };
    return [record];
}

/** The acquisition window of a search, when it has one (M2M wants both ends). */
function acquisitionFilter(request: SceneSearch): { acquisitionFilter?: { start: string; end: string } } {
    if (request.from === undefined && request.to === undefined) {
        return {};
    }
    return { acquisitionFilter: { start: request.from ?? '1950-01-01', end: request.to ?? '2100-12-31' } };
}

/** M25: a Landsat search's months (`seasonalFilter`) and cloud cap (`cloudCoverFilter`), when it has them. */
function landsatFilters(request: SceneSearch): Record<string, unknown> {
    return {
        ...(request.months === undefined ? {} : { seasonalFilter: [...request.months] }),
        ...(request.maxCloud === undefined ? {} : { cloudCoverFilter: { min: 0, max: request.maxCloud, includeUnknown: false } }),
    };
}

function sceneSearchBody(request: SceneSearch): unknown {
    const { west, south, east, north } = request.bounds;
    return {
        datasetName: request.dataset,
        sceneFilter: {
            spatialFilter: {
                filterType: 'mbr',
                lowerLeft: { latitude: south, longitude: west },
                upperRight: { latitude: north, longitude: east },
            },
            ...acquisitionFilter(request),
            ...landsatFilters(request),
        },
        metadataType: 'full',
        maxResults: request.maxResults,
        startingNumber: request.startingNumber ?? 1,
    };
}

/** The next page's first record, while there is one. */
function nextOf(data: unknown, returned: number): number | undefined {
    const [next, total] = [at(data, 'nextRecord'), at(data, 'totalHits')];
    return typeof next === 'number' && typeof total === 'number' && returned > 0 && next <= total ? next : undefined;
}

/** The first product's `datasetId` (EarthExplorer's id of the dataset, M4; checked where it is stored), when one names it. */
function datasetIdOf(products: readonly unknown[]): { datasetId?: string } {
    const datasetId = products.map((product) => stringAt(product, 'datasetId')).find((id) => id !== undefined);
    return datasetId === undefined ? {} : { datasetId };
}

/**
 * `download-options` per scene: available when any product of it is, its size the largest available product's, and the
 * dataset's EarthExplorer id its products carry.
 */
function toDownloadOptions(data: unknown, entityIds: readonly string[]): DownloadOption[] {
    const products = list(data);
    return entityIds.map((entityId) => {
        const own = products.filter((product) => at(product, 'entityId') === entityId);
        const available = own.filter((product) => at(product, 'available') === true);
        const bytes = Math.max(0, ...available.map((product) => Number(at(product, 'filesize') ?? 0)));
        return { entityId, available: available.length > 0, bytes, ...datasetIdOf(own) };
    });
}

/** `dataset-search`'s datasets as alias and EarthExplorer id (an entry without either is dropped). */
function toDatasets(data: unknown): DatasetIds[] {
    return list(data).flatMap((entry) => {
        const alias = stringAt(entry, 'datasetAlias');
        const datasetId = stringAt(entry, 'datasetId');
        return alias === undefined || datasetId === undefined ? [] : [{ alias, datasetId }];
    });
}

/**
 * M2M scene search and download availability (`docs/research/M3-interfaces.md` §3.1–§3.2): `scene-search` over the
 * city's bounds (`mbr`), with the full metadata, a page at a time; `download-options` for whether a frame is already
 * scanned; `dataset-search` for EarthExplorer's ids of the declassified datasets (M4: the order card's deep link). The
 * same failures as `createUsgsApi`'s; the API key goes in the `X-Auth-Token` header only.
 */
export function createUsgsScenes(options: UsgsOptions): UsgsScenes {
    return {
        search: async (apiKey, request) => {
            const data = await m2mCall(
                options,
                { endpoint: 'scene-search', body: sceneSearchBody(request), timeoutMs: request.timeoutMs },
                apiKey,
            );
            const records = list(at(data, 'results')).flatMap(toSceneRecord);
            const totalHits = at(data, 'totalHits');
            const next = nextOf(data, records.length);
            const page = { records, totalHits: typeof totalHits === 'number' ? totalHits : records.length };
            return next === undefined ? page : { ...page, next };
        },
        downloadOptions: async (apiKey, dataset, entityIds) =>
            toDownloadOptions(
                await m2mCall(options, { endpoint: 'download-options', body: { datasetName: dataset, entityIds: [...entityIds] } }, apiKey),
                entityIds,
            ),
        datasets: async (apiKey) =>
            toDatasets(await m2mCall(options, { endpoint: 'dataset-search', body: { datasetName: 'declass' } }, apiKey)),
    };
}
