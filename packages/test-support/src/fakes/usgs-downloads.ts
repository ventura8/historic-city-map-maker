import { fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import type { Bytes } from './png.js';
import { bodyField, requestObject, route, type Route, type RouteParams } from './routes.js';
import type { UpstreamRequest } from './fetch.js';
import { catalogueScene } from './usgs-catalogue.js';

/**
 * USGS downloads (docs/research/M3-interfaces.md §5.3 `fetch`, §13): `download-options` says whether a scene is scanned
 * and its size; `download-request` with a label stages it (at once, or after `preparingPolls` calls of
 * `download-retrieve`, as USGS prepares it); `download-retrieve` lists the label's downloads with a fresh signed address
 * each time; `download-order-remove` forgets them. The delivery host answers the signed address with the scene's bytes
 * (the synthetic scene the e2e world registers, else `E2E-SCAN-<download>`), honouring `Range` unless told not to, and
 * refusing an expired signature (403) so the pipeline asks `download-retrieve` again. Scenarios break it the ways the
 * pipeline must survive: a short file, a corrupt archive, a server without ranges.
 */

/** Where a delivery's bytes come from (read when first asked for). */
export type DeliverySource = () => Promise<Bytes> | Bytes;

/** The delivery host, and the path of its signed addresses. */
const DELIVERY_ORIGIN = 'https://dds.cr.usgs.gov';
const DELIVERY_PATH = '/e2e/download';
const DELIVERY_BASE = `${DELIVERY_ORIGIN}${DELIVERY_PATH}`;

interface UsgsDownload {
    readonly id: number;
    readonly entityId: string;
    readonly label: string;
    /** `download-retrieve` calls left before it is available. */
    pollsLeft: number;
}

export interface DownloadState {
    /** Download id → download, in request order. */
    readonly downloads: Map<number, UsgsDownload>;
    /** How many `download-retrieve` calls a new download stays preparing (0: available at once). */
    preparingPolls: number;
    /** Entity id → its delivery (`usgs-raw`'s archive); a scene without one delivers `E2E-SCAN-<download>`. */
    readonly deliveries: Map<string, DeliverySource>;
    /** The delivery server's behaviour (`usgs.*` scenarios). */
    readonly delivery: {
        /**
         * Where the signed addresses point: the delivery host, or a forward to it on loopback (the e2e mock APIs'
         * `/h/dds.cr.usgs.gov`, so the pipeline under the emulators never leaves the machine). The fake still answers
         * the delivery host's own addresses.
         */
        origin: string;
        /** False: `Range` is ignored and every GET answers the whole file (the pipeline restarts its upload). */
        rangeSupported: boolean;
        /** The next this-many signatures are already expired when issued (403 on their first use). */
        expireNext: number;
        /** The delivery is shorter than `download-options` says (`apiError.imagery.downloadIncomplete`). */
        truncated: boolean;
        /** The delivery is not an archive (`apiError.imagery.archiveCorrupt`). */
        corrupt: boolean;
    };
    /** Signatures issued so far, and those that expired. */
    readonly signatures: { next: number; readonly expired: Set<string> };
    /**
     * M4 (docs/research/M4-interfaces.md §1, §8): USGS delivered the scans bought in EarthExplorer (`usgs.ordersDelivered`):
     * every scene that had to be ordered is downloadable from then on.
     */
    ordersDelivered: boolean;
}

export function defaultDownloadState(): DownloadState {
    return {
        downloads: new Map(),
        preparingPolls: 0,
        deliveries: new Map(),
        delivery: { origin: DELIVERY_ORIGIN, rangeSupported: true, expireNext: 0, truncated: false, corrupt: false },
        signatures: { next: 0, expired: new Set() },
        ordersDelivered: false,
    };
}

/**
 * True when the scene can be downloaded: scanned already, (M4) bought and delivered, or (M8) a frame of a date's set that a
 * spec gave a delivery of its own, which the catalogue need not list.
 */
function scanned(state: DownloadState, entityId: string): boolean {
    const scene = catalogueScene(entityId);
    return state.deliveries.has(entityId) || (scene !== undefined && (scene.result.options.download || state.ordersDelivered));
}

/** EarthExplorer's own id of each dataset, as `dataset-search` names them (Declass 3's is not recorded: null). */
function earthExplorerId(dataset: string | undefined): string | null {
    const datasets = (fixtureBody('usgs/dataset-search.declass') as { data: { datasetAlias: string; datasetId: string }[] }).data;
    return datasets.find((entry) => entry.datasetAlias === dataset)?.datasetId ?? null;
}

/** The first download id (`download-request.available.json`). */
const FIRST_DOWNLOAD = 300_000_001;
/** What `download-options` says of a scanned scene without a registered delivery (Declass 1's usual archive). */
const DEFAULT_SIZE = 734_003_200;

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
    corona2: 'Declass 1 Product',
    declassii: 'Declass 2 Product',
    declassiii: 'Declass 3 Product',
    // M25: what USGS calls a Level-1 product bundle.
    landsat_tm_c2_l1: 'Landsat Collection 2 Level-1 Product Bundle',
    landsat_etm_c2_l1: 'Landsat Collection 2 Level-1 Product Bundle',
    landsat_ot_c2_l1: 'Landsat Collection 2 Level-1 Product Bundle',
};

const textBytes = (text: string): Bytes => new TextEncoder().encode(text);

async function deliveryBytes(state: DownloadState, download: UsgsDownload): Promise<Bytes> {
    const source = state.deliveries.get(download.entityId);
    return source === undefined ? textBytes(`E2E-SCAN-${String(download.id)}`) : await source();
}

/** The bytes the delivery server sends: the file, or the scenario's short or corrupt version of it. */
function served(state: DownloadState, bytes: Bytes): Bytes {
    if (state.delivery.truncated) {
        return bytes.subarray(0, Math.max(0, bytes.length - Math.min(1024, Math.ceil(bytes.length / 2))));
    }
    return state.delivery.corrupt ? new Uint8Array(bytes.length).fill(0xab) : bytes;
}

/** A fresh signed address of a download (the signature is the query the pipeline's logger must redact). */
function signedUrl(state: DownloadState, download: UsgsDownload): string {
    state.signatures.next += 1;
    const signature = `e2e-sig-${String(state.signatures.next).padStart(4, '0')}`;
    if (state.delivery.expireNext > 0) {
        state.delivery.expireNext -= 1;
        state.signatures.expired.add(signature);
    }
    return `${state.delivery.origin}${DELIVERY_PATH}/${String(download.id)}?sig=${signature}&expires=1792008000`;
}

function entityIdsOf(request: UpstreamRequest): string[] {
    const ids = bodyField(request, 'entityIds');
    return Array.isArray(ids) ? ids.map(String) : [];
}

async function sizeOf(state: DownloadState, entityId: string, available: boolean): Promise<number> {
    if (!available) {
        return 0;
    }
    const source = state.deliveries.get(entityId);
    return source === undefined ? DEFAULT_SIZE : (await source()).length;
}

/** `download-options`: each scene's availability and size (a scene the catalogue does not know must be ordered). */
export async function downloadOptions(request: UpstreamRequest, state: DownloadState): Promise<unknown[]> {
    const template = (fixtureBody('usgs/download-options.available') as { data: Record<string, unknown>[] }).data[0] ?? {};
    return Promise.all(
        entityIdsOf(request).map(async (entityId) => {
            const scene = catalogueScene(entityId);
            const available = scanned(state, entityId);
            return {
                ...template,
                entityId,
                displayId: entityId,
                datasetId: earthExplorerId(scene?.dataset),
                available,
                bulkAvailable: available,
                filesize: await sizeOf(state, entityId, available),
                productName: PRODUCT_NAMES[scene?.dataset ?? 'corona2'],
            };
        }),
    );
}

interface RequestedDownload {
    readonly entityId: string;
}

function requestedDownloads(request: UpstreamRequest): RequestedDownload[] {
    const downloads = bodyField(request, 'downloads');
    return (Array.isArray(downloads) ? (downloads as { entityId?: unknown }[]) : [])
        .filter((item) => typeof item.entityId === 'string')
        .map((item) => ({ entityId: String(item.entityId) }));
}

/** A request's `label` ('' without one). */
function labelOf(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** The label's download of a scene, created on first request (a retry with the same label reuses it). */
function downloadFor(state: DownloadState, entityId: string, label: string): UsgsDownload {
    const existing = [...state.downloads.values()].find((download) => download.entityId === entityId && download.label === label);
    if (existing !== undefined) {
        return existing;
    }
    const download = { id: FIRST_DOWNLOAD + state.downloads.size, entityId, label, pollsLeft: state.preparingPolls };
    state.downloads.set(download.id, download);
    return download;
}

/** `download-request`: stages each scanned scene under the request's label; an unscanned one fails. */
export function downloadRequest(request: UpstreamRequest, state: DownloadState): unknown {
    const label = labelOf(bodyField(request, 'label'));
    const asked = requestedDownloads(request);
    const ready = asked.filter((item) => scanned(state, item.entityId));
    const downloads = ready.map((item) => downloadFor(state, item.entityId, label));
    return {
        availableDownloads: downloads
            .filter((download) => download.pollsLeft === 0)
            .map((download) => ({ downloadId: download.id, eulaCode: null, url: signedUrl(state, download) })),
        duplicateProducts: [],
        preparingDownloads: downloads
            .filter((download) => download.pollsLeft > 0)
            .map((download) => ({ downloadId: download.id, eulaCode: null, url: null })),
        failed: asked
            .filter((item) => !ready.includes(item))
            .map((item) => ({ entityId: item.entityId, errorMessage: 'The product is not available for download' })),
        newRecords: Object.fromEntries(downloads.map((download) => [String(download.id), download.entityId])),
        numInvalidScenes: asked.length - ready.length,
    };
}

function retrieveTemplates(): { readonly available: Record<string, unknown>; readonly requested: Record<string, unknown> } {
    const available = (fixtureBody('usgs/download-retrieve.available') as { data: { available: Record<string, unknown>[] } }).data;
    const requested = (fixtureBody('usgs/download-retrieve.preparing') as { data: { requested: Record<string, unknown>[] } }).data;
    return { available: available.available[0] ?? {}, requested: requested.requested[0] ?? {} };
}

/** `download-retrieve`: the label's downloads (every one without a label), each poll bringing a preparing one closer. */
export function downloadRetrieve(request: UpstreamRequest, state: DownloadState): unknown {
    const label = bodyField(request, 'label');
    const mine = [...state.downloads.values()].filter((download) => label === undefined || download.label === label);
    const ready = mine.filter((download) => download.pollsLeft === 0);
    const preparing = mine.filter((download) => download.pollsLeft > 0);
    preparing.forEach((download) => {
        download.pollsLeft -= 1;
    });
    const templates = retrieveTemplates();
    const describe = (download: UsgsDownload) => ({ downloadId: download.id, entityId: download.entityId, displayId: download.entityId });
    return {
        available: ready.map((download) => ({ ...templates.available, ...describe(download), url: signedUrl(state, download) })),
        requested: preparing.map((download) => ({ ...templates.requested, ...describe(download) })),
        queueSize: preparing.length,
        eulas: [],
    };
}

/** `download-order-remove`: the label's downloads leave the queue. */
export function downloadOrderRemove(request: UpstreamRequest, state: DownloadState): void {
    const label = labelOf(requestObject(request)['label']);
    [...state.downloads.values()].filter((download) => download.label === label).forEach((download) => state.downloads.delete(download.id));
}

/** `bytes=<first>-<last>` (or `<first>-`) of a Range header, clamped to the file; undefined for none or a bad one. */
function rangeOf(header: string | null, size: number): { readonly first: number; readonly last: number } | undefined {
    const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
    if (match === null) {
        return undefined;
    }
    const first = Number(match[1]);
    const last = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    return first <= last ? { first, last } : undefined;
}

/** A file's bytes as an HTTP server with (or without) range support sends them. */
export function rangedResponse(request: UpstreamRequest, bytes: Bytes, type: string, rangeSupported: boolean): Response {
    const range = rangeSupported ? rangeOf(request.headers.get('range'), bytes.length) : undefined;
    const common: Record<string, string> = { 'content-type': type, ...(rangeSupported ? { 'accept-ranges': 'bytes' } : {}) };
    if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { ...common, 'content-length': String(bytes.length) } });
    }
    if (range === undefined) {
        return new Response(bytes, { status: 200, headers: common });
    }
    return new Response(bytes.subarray(range.first, range.last + 1), {
        status: 206,
        headers: { ...common, 'content-range': `bytes ${String(range.first)}-${String(range.last)}/${String(bytes.length)}` },
    });
}

/** The delivery host: the signed address of a staged download. */
function deliver(state: DownloadState): (request: UpstreamRequest, params: RouteParams) => Promise<Response> {
    return async (request, params) => {
        const download = state.downloads.get(Number(params['download']));
        const signature = request.url.searchParams.get('sig') ?? '';
        if (download === undefined || signature === '' || state.signatures.expired.has(signature)) {
            return fixtureResponse('usgs/delivery.expired');
        }
        const bytes = served(state, await deliveryBytes(state, download));
        return rangedResponse(request, bytes, 'application/octet-stream', state.delivery.rangeSupported);
    };
}

/** The delivery host's routes (GET for the bytes, HEAD for the size). */
export function deliveryRoutes(state: DownloadState): Route[] {
    return [
        route('GET', `${DELIVERY_BASE}/{download}`, 'usgs.delivery', deliver(state)),
        route('HEAD', `${DELIVERY_BASE}/{download}`, 'usgs.delivery.head', deliver(state)),
    ];
}

/** The scenarios of the download flow (`usgs.<name>`). */
export function downloadScenarios(state: DownloadState): Record<string, () => void> {
    return {
        downloadsPreparing: () => {
            state.preparingPolls = 1;
        },
        signedUrlExpiresOnce: () => {
            state.delivery.expireNext = 1;
        },
        deliveryWithoutRanges: () => {
            state.delivery.rangeSupported = false;
        },
        shortDelivery: () => {
            state.delivery.truncated = true;
        },
        corruptArchive: () => {
            state.delivery.corrupt = true;
        },
        ordersDelivered: () => {
            state.ordersDelivered = true;
        },
    };
}
