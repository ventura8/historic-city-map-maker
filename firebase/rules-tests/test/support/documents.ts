/**
 * The documents the rules tests seed and write, built from the shared contract (docs/research/M2-interfaces.md §2):
 *
 * - `*Doc` builders are complete server documents: every key their zod schema knows, each with a valid value
 *   (`documents.test.ts` checks both), so a rule that forgets a server-owned field refuses every edit of a real
 *   document and fails the tests;
 * - `new*` builders are what an admin's create sends: exactly the keys of `CLIENT_WRITES[entity].create`;
 * - `EDITS` holds one valid new value for every field `CLIENT_WRITES[entity].update` lists (the stamp aside).
 *
 * Every value is a generated test value; the one shaped like a Google API key is assembled at run time.
 */
import { CLIENT_WRITES, STORAGE_PATHS, publicObjectUrl, type ClientCollection } from '@hcm/shared';

import { archiveJobFields } from './archive-fields.js';
import { derivative, reviewedFields, versionEdits, versionFields } from './photo-fields.js';
import { POI_CATEGORY_EDITS } from './poi-categories.js';
import { STORY_EDITS } from './stories.js';
import { later, past, serverTime, stampedBy, systemStamp, type Data } from './world.js';

export { newPoiCategory, poiCategoryDoc } from './poi-categories.js';

/** The bounds every test city gets: photo locations must fall within them (±0.5°). */
export const CITY_BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 } as const;

const SHA = 'ab'.repeat(32);
const PUBLIC_BUCKET = 'demo-hcm-public';
const API_KEY = `${['AI', 'za'].join('')}${'RulesFakeKey'.padEnd(35, '0')}`;

function tokens(primary: string): Data {
    return { '--md-sys-color-primary': primary, '--md-sys-color-on-primary': '#ffffff' };
}

/** A generated theme: every scheme has tokens (the rules check the counts, the builder the values). */
export function theme(seedColor: string): Data {
    return {
        seedColor,
        tokens: {
            light: tokens(seedColor),
            dark: tokens(seedColor),
            highContrastLight: tokens(seedColor),
            highContrastDark: tokens(seedColor),
        },
    };
}

/** `count` valid links (at most five are allowed). */
export function links(count: number): Data[] {
    return Array.from({ length: count }, (_, index) => ({
        url: `https://example.org/sursa/${String(index)}`,
        label: `Sursa ${String(index + 1)}`,
    }));
}

/** A closed ring of `count` vertices (the last repeats the first) around Bucharest's centre. */
export function closedRing(count: number): Data[] {
    const open = Array.from({ length: count - 1 }, (_, index) => ({ lat: 44.43 + index / 1000, lng: 26.1 + (index % 2) / 1000 }));
    return [...open, open[0] ?? { lat: 44.43, lng: 26.1 }];
}

/** `count` vertices of an open line. */
export function line(count: number): Data[] {
    return Array.from({ length: count }, (_, index) => ({ lat: 44.43 + index / 10_000, lng: 26.1 }));
}

export function cityDoc(cityId: string): Data {
    return {
        id: cityId,
        name: { ro: 'București', en: 'Bucharest' },
        bounds: CITY_BOUNDS,
        center: { lat: 44.43, lng: 26.1 },
        zoom: 12,
        minZoom: 10,
        maxZoom: 18,
        about: { ro: 'Despre hartă.', en: 'About the map.' },
        privacy: { ro: 'Confidențialitate.', en: 'Privacy.' },
        credits: [{ label: { ro: 'Arhiva', en: 'Archive' }, url: 'https://example.org/arhiva' }],
        theme: theme('#875329'),
        basemap: { style: 'mapbox://styles/mapbox/standard', config: { lightPreset: 'day', show3dObjects: false } },
        mapbox: {
            user: 'hcm-test',
            publicToken: 'pk.rules-test-viewer',
            publicTokenId: 'rulestestviewer',
            allowedUrls: ['https://ventura8.github.io'],
        },
        analytics: {
            measurementId: 'G-RULESTEST',
            errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
            firebase: { apiKey: API_KEY, appId: '1:123456:web:abc123', projectId: 'demo-hcm' },
        },
        engine: { minVersion: '1.0.0' },
        photosOverlay: { defaultOpacity: 0.9 },
        imagery: { autoPublish: true, rmseThresholdM: 15, targetYears: [1966, 1976, 1977, 1978, 1980] },
        // M28: the map's sources, saved on their own (Setup's Sources step).
        sources: { usgs: true, cloudAi: false },
        // M5 (docs/research/M5-interfaces.md §1.8): the city's share of the budgets, server-owned.
        limits: { computeUnitsPerMonth: 5, rasterJobsPerDay: 3, aiRequestsPerMonth: 100, geocodeCellsPerDay: 100, exportsPerDay: 3 },
        icon: { source: 'custom', url: 'https://storage.googleapis.com/b/icon-180.png', sha256: 'c'.repeat(64), ...systemStamp('icon') },
        published: true,
        createdAt: past(),
        ...systemStamp('setup'),
    };
}

/** A processed photo (`photos.onUpload` ran) with every field the schema knows. */
export function photoDoc(cityId: string, photoId: string, creator: string): Data {
    return {
        ...photoText(),
        license: 'CC-BY-4.0',
        links: links(1),
        location: { lat: 44.4462, lng: 26.0969 },
        bearing: 90,
        fov: 60,
        kind: 'ground',
        published: false,
        rightsReview: false,
        image: { web: derivative(cityId, photoId, 'web'), thumb: derivative(cityId, photoId, 'thumb'), sha256: SHA, w: 2048, h: 1536 },
        exif: { Make: 'Zeiss Ikon', ExposureTime: 0.004 },
        processing: 'done',
        processingError: 'apiError.photo.duplicate',
        duplicateOf: 'p-original',
        suggested: { location: { lat: 44.446, lng: 26.097 }, year: 1936, bearing: 85, title: 'Piata Romana 1936' },
        original: {
            path: STORAGE_PATHS.photoOriginal(cityId, photoId, SHA, 'image/jpeg'),
            contentType: 'image/jpeg',
            bytes: 1_048_576,
            sha256: SHA,
        },
        replacement: { error: 'apiError.photo.duplicate', at: past(), duplicateOf: 'p-original' },
        heldImage: {
            web: `review-held/${cityId}/${photoId}/w.webp`,
            thumb: `review-held/${cityId}/${photoId}/t.webp`,
            sha256: SHA,
            w: 2048,
            h: 1536,
        },
        ...reviewedFields(creator),
        credit: 'Ion Mureșan',
        ...versionFields(),
        createdAt: past(),
        createdBy: creator,
        ...systemStamp('photos'),
    };
}

function photoText(): Data {
    return {
        title: { ro: 'Piața Romană', en: 'Roman Square' },
        description: { ro: 'Vedere spre nord.', en: 'Looking north.' },
        year: 1936,
        yearEnd: 1936,
        month: 7,
        day: 12,
        dateText: { ro: 'Iulie 1936', en: 'July 1936' },
        author: 'Ion Mureșan',
        rightsHolder: 'Ion Mureșan',
        sourceUrl: 'https://example.org/foto/1',
        sourceLabel: 'Arhiva familiei',
        permissionNote: 'Permisiune scrisă pentru proiect.',
        legacyId: 'ci9e9tn7b0356kzkuzlkncngf',
    };
}

/** What the admin sends to create a photo: every client field, unprocessed and unpublished. */
export function newPhoto(uid: string): Data {
    return {
        ...photoText(),
        license: 'permission-legacy',
        links: links(5),
        location: { lat: 44.4462, lng: 26.0969 },
        bearing: 360,
        fov: 180,
        kind: 'ground',
        published: false,
        rightsReview: true,
        credit: 'Ion Mureșan',
        versionCredits: { improved: 'Ana Pop' },
        processing: 'pending',
        createdAt: serverTime(),
        createdBy: uid,
        ...stampedBy(uid),
    };
}

export function layerDoc(): Data {
    return {
        year: 1966,
        date: '1966-08-20',
        label: { ro: 'Corona 1966', en: 'Corona 1966' },
        description: { ro: 'Fotografie declasificată.', en: 'Declassified photograph.' },
        kind: 'satellite',
        sensor: 'KH-4A',
        attribution: 'Courtesy of the U.S. Geological Survey',
        source: { type: 'mapbox', tilesetId: 'hcm-test.corona-1966' },
        minzoom: 8,
        maxzoom: 17,
        bounds: CITY_BOUNDS,
        order: 1,
        opacity: 0.8,
        defaultVisible: true,
        adjustments: { brightnessMin: 0.1, brightnessMax: 0.9, contrast: 0.2, saturation: -0.5 },
        // M20 (docs/research/M20-import-local.md §7): a drawn map's licence, author and source, written by finalize.
        rights: { licence: 'PD', author: 'IGA', source: { label: 'Idei Urbane – DocuBucurești', url: 'https://ideiurbane.ro/' } },
        status: 'ready',
        published: true,
        provenance: {
            usgsEntityId: 'DS1034-1057DA024',
            usgsDataset: 'corona2',
            georef: { method: 'gcps', gcpCount: 12, checkpointRmseM: 4.5 },
        },
        mapbox: { tilesetId: 'hcm-test.corona-1966', publishedSourceSha: SHA, sourceId: 'corona-1966', origin: 'mts' },
        currentVersion: 'v-1966',
        pendingVersion: 'v-1966-crop',
        retired: { by: 'jn-1966', at: past() },
        createdAt: past(),
        ...systemStamp('imagery'),
    };
}

function poiText(): Data {
    return {
        category: 'cladiri',
        title: { ro: 'Biserica Enei', en: 'Enei Church' },
        description: { ro: 'Demolată în **1977**.', en: 'Demolished in **1977**.' },
        yearStart: 1850,
        yearEnd: 1977,
        yearSeen: 1939,
        sourceLayer: 'plan-1911',
        links: links(2),
        photoIds: ['p1', 'p2'],
    };
}

export function poiDoc(creator: string): Data {
    return {
        ...poiText(),
        geometry: { type: 'Polygon', rings: [{ points: closedRing(5) }] },
        published: true,
        ...reviewedFields(creator),
        credit: 'Ion Mureșan',
        createdAt: past(),
        createdBy: creator,
        updatedBy: creator,
        updatedAt: past(),
    };
}

export function newPoi(uid: string): Data {
    return {
        ...poiText(),
        geometry: { type: 'Point', point: { lat: 44.4355, lng: 26.1003 } },
        published: false,
        credit: 'Ion Mureșan',
        createdAt: serverTime(),
        createdBy: uid,
        ...stampedBy(uid),
    };
}

/** A running job with every field the runner owns. */
export function jobDoc(creator: string, status = 'running'): Data {
    return {
        type: 'usgs-import',
        status,
        params: { entityId: 'DS1034-1057DA024' },
        createdBy: creator,
        createdAt: past(),
        cancelRequested: false,
        step: 'fetch',
        progress: 0.25,
        retryAt: later(),
        dispatchAt: past(),
        executionName: 'projects/demo-hcm/locations/us-central1/jobs/raster-std/executions/raster-std-abc',
        machine: 'std',
        attempt: 1,
        lostRuns: 1,
        publishAttempts: 1,
        lease: { owner: 'raster-std-abc', until: later() },
        steps: { fetch: { status: 'running', gcsPath: 'usgs-raw/rules/frame.tgz', generation: '1700000000000000', sha256: SHA } },
        mapboxJobId: 'mts-job-1',
        error: { code: 'apiError.usgs.unavailable', message: 'USGS did not answer.', params: { attempt: '1' } },
        ...{ layerId: 'corona-1966', versionId: 'job-1966' },
        waitReason: 'usgs-preparing',
        startedAt: past(),
        finishedAt: later(),
        // M7 (docs/research/M7-local-worker.md §3, §4): where it runs, the worker that claimed it, the free-tier OK, the count.
        runOn: 'local',
        worker: { id: 'w-0123456789abcdef', uid: creator, claimedAt: past() },
        freeTierOk: { by: creator, at: past() },
        usageCountedAt: past(),
        // Finding 68 of 2026-11-02: imagery.tick's mark of a local job no computer came for.
        workerOverdueAt: past(),
        filesOn: 'cloud',
        // M7 hand-over: workers that held the job and lost it (imagery.tick / claim).
        lostOn: ['w-0123456789abcdef'],
        // M18 item 3: the pipeline image a parked frame was searched with (imagery.tick's relocate part).
        searchedWith: `sha256:${'ab'.repeat(32)}`,
        // Review of M18 item 3: an editor placing points on the parked frame (the georeferencer's mark).
        placingPoints: true,
        // M20 (docs/research/M20-import-local.md §1.1, §1.3): an archive series' originals on the computer, and the day it counted.
        ...archiveJobFields(),
        // Pause (the owner's request of 2026-11-13): the owner paused it, and its computer was paused (imagery.pause only).
        ...{ paused: { by: creator, at: past(), inRun: true }, releaseRequested: true },
        ...systemStamp('pipeline'),
    };
}

/** What a client would send to queue a job itself (M2's create, refused since M3: CR-M3-2). */
export function newJob(uid: string): Data {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1034-1057DA024' },
        createdBy: uid,
        createdAt: serverTime(),
        ...stampedBy(uid),
    };
}

/** A city's local worker (M7, `worker.hello` and `worker.claim`): written by the worker callables only. */
export function workerDoc(uid: string): Data {
    return {
        uid,
        version: '1.0.0',
        startedAt: past(),
        lastSeenAt: past(),
        ...{ state: 'busy', jobId: 'job-1966' },
        lastJob: { id: 'job-1965', outcome: 'done', at: past() },
        // Pause this computer (2026-11-13): imagery.pause, or the computer's own page through worker.claim.
        paused: { by: uid, at: past(), until: later() },
        ...{ updatedBy: uid, updatedAt: past() },
    };
}

/** A city's remembered choice of where raster jobs run (M7, `imagery.runOn`). */
export function runChoiceDoc(uid: string): Data {
    return { choice: 'auto', updatedBy: uid, updatedAt: past() };
}

export function jobLogDoc(): Data {
    return { seq: 1, level: 'info', step: 'fetch', message: 'fetch: 12% of 1.2 GB', ...systemStamp('pipeline') };
}

export function usgsSceneDoc(status = 'candidate'): Data {
    return {
        entityId: 'DS1034-1057DA024',
        dataset: 'corona2',
        acquisitionDate: '1966-08-20',
        displayId: 'DS1034-1057DA024',
        sensor: 'KH-4A',
        status,
        note: 'Acoperire bună.',
        downloadAvailable: true,
        footprint: [
            { lat: 44.2, lng: 25.8 },
            { lat: 44.7, lng: 25.8 },
            { lat: 44.7, lng: 26.4 },
        ],
        corners: {
            nw: { lat: 44.7, lng: 25.8 },
            ne: { lat: 44.7, lng: 26.4 },
            se: { lat: 44.2, lng: 26.4 },
            sw: { lat: 44.2, lng: 25.8 },
        },
        cloudCover: 5,
        resolutionM: 2.75,
        coverage: 0.92,
        browse: {
            state: 'copied',
            sourceUrl: 'https://ims.cr.usgs.gov/browse/declass1/DS1034-1057DA024.jpg',
            path: 'usgs-browse/corona2/DS1034-1057DA024.jpg',
            checkedAt: past(),
        },
        rank: { score: 92, reasons: [{ code: 'free' }, { code: 'coverage', params: { percent: '92' } }], version: 1 },
        layerId: 'corona-1966',
        // The owner's report of 2026-11-13 (M4 §1.9): Not useful and the browse image's clouds, written by the functions only.
        unusable: { reason: 'clouds', at: past() },
        cloudEstimate: { percent: 46, version: 1 },
        // M4 (docs/research/M4-interfaces.md §1): EarthExplorer's dataset id and the order, written by the functions only.
        eeDatasetId: '5e839febdccb64b3',
        order: {
            state: 'imported',
            orderedAt: past(),
            orderedBy: 'uid-owner',
            checks: 9,
            lastCheckedAt: past(),
            nextCheckAt: later(),
            remindersSent: [7],
            deliveredAt: past(),
            importJobId: 'job-1966',
            importedAt: past(),
            expiredAt: past(),
            lastError: 'apiError.usgs.maintenance',
        },
        harvestedAt: past(),
        createdAt: past(),
        ...systemStamp('imagery'),
    };
}

/** A history entry as the triggers write it, naming its city (CR-M2c-14). */
export function historyEntryDoc(editor: string, cityId = 'matrix-city'): Data {
    return {
        cityId,
        entity: 'photo',
        entityId: 'p1',
        action: 'update',
        previous: { title: { ro: 'Piața Romană' }, published: false },
        changedFields: ['title'],
        updatedBy: editor,
        updatedAt: past(),
    };
}

export function adminDoc(): Data {
    return {
        role: 'owner',
        email: 'owner@example.test',
        displayName: 'Proprietar',
        invitedBy: 'bootstrap',
        createdAt: past(),
        ...systemStamp('admins'),
    };
}

export function inviteDoc(inviter: string): Data {
    return { role: 'admin', invitedBy: inviter, createdAt: past(), expiresAt: later(), updatedBy: inviter, updatedAt: past() };
}

export function ownerDoc(uid: string): Data {
    return { uid, claimedAt: past(), updatedBy: uid, updatedAt: past() };
}

export function setupStatusDoc(): Data {
    return {
        billing: {
            state: 'ok',
            checkedAt: past(),
            budgetId: 'billingAccounts/0123-4567-89AB/budgets/hcm-budget',
            budgetAmount: 5,
            currency: 'USD',
        },
        provision: { state: 'pending', items: [{ id: 'apis', state: 'ok', checkedAt: past() }] },
        mapbox: {
            state: 'ok',
            user: 'hcm-test',
            scopes: ['styles:read', 'tokens:write'],
            tilesTokenId: 'tilestoken',
            adminToken: 'pk.rules-test-admin',
            adminTokenId: 'admintoken',
            adminAllowedUrls: ['https://demo-hcm.web.app'],
            retiring: [{ tokenId: 'oldtoken', retireAt: later() }],
        },
        usgs: { state: 'pending', role: 'search', nextCheckAt: later(), tokenExpiresAt: later() },
        analytics: { state: 'unavailable', detail: 'apiError.unavailable' },
        crash: { state: 'ok', lastReportAt: past() },
        secretsRev: 3,
        ...systemStamp('setup'),
    };
}

export function usageDoc(): Data {
    return {
        month: '2026-10',
        computeUnits: 12.5,
        computeUnitBudget: 100,
        uploadedMb: 300,
        publishes: 2,
        studioUploads: 0,
        reservations: { 'job-1966': { computeUnits: 4.2, at: past(), newTileset: true } },
        overageComputeUnits: 0,
        ...systemStamp('imagery'),
    };
}

/** A layer version (M3) its pipeline is still working on: written by the imagery functions and the pipeline only. */
export function layerVersionDoc(): Data {
    return {
        layerId: 'corona-1966',
        jobId: 'job-1966',
        origin: 'usgs',
        state: 'processing',
        source: { kind: 'usgs', entityId: 'DS1034-1057DA024', dataset: 'corona2', sensor: 'KH-4A', acquisitionDate: '1966-08-20' },
        label: { ro: 'KH-4A Corona, 20 august 1966', en: 'KH-4A Corona, 20 August 1966' },
        year: 1966,
        date: '1966-08-20',
        sensor: 'KH-4A',
        createdBy: 'uid-owner',
        createdAt: past(),
        ...systemStamp('pipeline'),
    };
}

export function opsGuardDoc(): Data {
    return {
        state: 'green',
        since: past(),
        spend: { costAmount: 5.37, budgetAmount: 5, currency: 'USD', interval: '2026-10-01T07:00:00Z' },
        resumedBy: 'uid-owner',
        resumedAt: past(),
        resumedFor: '2026-10-01T07:00:00Z',
        lastTick: { ranAt: past(), steps: [{ step: 'guard', ok: true }] },
        lastNightlyAt: past(),
        ...systemStamp('ops'),
    };
}

/** A city's last USGS harvest attempt (CR-M3-47). */
export function harvestStateDoc(): Data {
    return {
        attemptedAt: past(),
        outcome: 'failed',
        failures: 2,
        nextAt: later(),
        error: 'apiError.usgs.unavailable',
        ...systemStamp('imagery'),
    };
}

export function manifestStateDoc(cityId: string): Data {
    return {
        requestedVersion: 3,
        builtVersion: 3,
        status: 'idle',
        builtAt: past(),
        url: publicObjectUrl(PUBLIC_BUCKET, STORAGE_PATHS.manifest(cityId)),
        sha256: SHA,
        bytes: 1234,
        counts: { layers: 1, photos: 2, pois: 1, poiCategories: 1 },
        skipped: [],
        ...systemStamp('publish'),
    };
}

/** One valid new value for every field an admin may update (the stamp aside), per collection. */
// ---- M4 notifications and assists (docs/research/M4-interfaces.md §4.2, §5.6; owner: assists-notify) ----------------

/** What every notification event and inbox item says. */
function notice(): Data {
    return {
        kind: 'job.failed',
        severity: 'error',
        cityId: 'matrix-city',
        params: { label: 'Corona 1966', labelEn: 'Corona 1966 (EN)' },
        link: '#/imagery/version/job-1966',
        createdAt: past(),
    };
}

/** An inbox item as `notify.onEvent` writes it, then pushed and read (`unread` for a fresh one): every field of `inboxItemDocSchema`. */
export function inboxItemDoc(): Data {
    return { ...notice(), read: true, readAt: past(), pushedAt: past(), ...systemStamp('notify') };
}

/** An admin's push settings, as the admin's client saves them. */
export function notifySettingsDoc(uid: string): Data {
    return { push: true, pushKinds: ['job.failed', 'budget.paused'], createdAt: past(), updatedBy: uid, updatedAt: past() };
}

/** The admin's first save of their push settings: exactly `CLIENT_WRITES.notifySettings.create`. */
export function newNotifySettings(uid: string): Data {
    return { push: false, pushKinds: ['order.reminder'], createdAt: serverTime(), ...stampedBy(uid) };
}

/** A browser registered by `notify.registerDevice` (a generated test token). */
export function pushDeviceDoc(uid: string): Data {
    return {
        token: 'rules-fcm-token:abcdefghijklmnopqrstuvwxyz',
        lang: 'ro',
        createdAt: past(),
        lastPushedAt: past(),
        updatedBy: uid,
        updatedAt: past(),
    };
}

/** A notification event as a producer creates it and the fan-out completes it. */
export function notificationEventDoc(): Data {
    return { ...notice(), fannedOutAt: past(), recipients: 2, ...systemStamp('imagery') };
}

/** A cached reverse-geocoding cell (`assistGeocodes/{key}`). */
export function geocodeCellDoc(): Data {
    return {
        state: 'failed',
        suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }],
        attribution: 'Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright',
        error: 'apiError.assist.rateLimited',
        requestedAt: past(),
        answeredAt: past(),
        expiresAt: later(),
        ...systemStamp('assist'),
    };
}

/** The AI drafts' monthly counters (`usage/ai-YYYY-MM`). */
export function aiUsageDoc(): Data {
    return { month: '2026-10', requests: 3, inputTokens: 300, outputTokens: 30, usd: 0.0001, ...systemStamp('assist') };
}

// ---- end of M4 ---------------------------------------------------------------------------------------------------------

export const EDITS: Readonly<Record<ClientCollection, Readonly<Data>>> = {
    city: {
        name: { ro: 'Bucureștiul dispărut' },
        bounds: { west: 25.8, south: 44.2, east: 26.4, north: 44.7 },
        center: { lat: 44.44, lng: 26.11 },
        zoom: 13,
        minZoom: 9,
        maxZoom: 19,
        about: { ro: 'Despre.' },
        privacy: { ro: 'Date personale.', en: 'Personal data.' },
        credits: [],
        theme: theme('#336699'),
        basemap: { style: 'https://example.org/styles/historic.json' },
        photosOverlay: { defaultOpacity: 0.5 },
        imagery: { autoPublish: false, rmseThresholdM: 25, targetYears: [1911, 1966] },
        sources: { usgs: false, landsat: true },
        published: false,
    },
    photo: {
        title: { ro: 'Calea Victoriei' },
        description: { ro: 'Vedere spre sud.' },
        year: 1936,
        yearEnd: 1936,
        month: 2,
        day: 29,
        dateText: { ro: 'Vara lui 1936' },
        author: 'Necunoscut',
        license: 'CC0',
        rightsHolder: 'Arhiva Națională',
        sourceUrl: 'https://example.org/foto/2',
        sourceLabel: 'Arhiva Națională',
        permissionNote: 'Domeniu public.',
        legacyId: 'legacy-2',
        links: links(5),
        location: { lat: 44.3 - 0.5, lng: 26.3 + 0.5 },
        bearing: 0,
        fov: 1,
        kind: 'aerial',
        published: true,
        rightsReview: true,
        credit: 'Maria Popescu',
        ...versionEdits(),
    },
    layer: {
        label: { ro: 'București, 1966' },
        description: { ro: 'Corona KH-4A.' },
        attribution: 'USGS',
        year: 1967,
        date: '1967-05-31',
        order: 2,
        opacity: 0,
        defaultVisible: false,
        adjustments: { brightnessMin: 0, brightnessMax: 1, contrast: -1, saturation: 1 },
        published: false,
    },
    poi: {
        category: 'strazi',
        geometry: { type: 'LineString', points: line(500) },
        title: { ro: 'Strada Sfinților' },
        description: { ro: 'O [sursă](https://example.org).' },
        ...{ yearStart: 1900, yearEnd: 1980, yearSeen: 1939 },
        links: links(5),
        photoIds: Array.from({ length: 20 }, (_, index) => `p${String(index)}`),
        ...{ published: false, credit: 'Maria Popescu', sourceLayer: 'plan-1911' },
    },
    poiCategory: POI_CATEGORY_EDITS,
    story: STORY_EDITS,
    job: { cancelRequested: true, placingPoints: true },
    usgsScene: { status: 'rejected', note: 'Nori peste oraș.' },
    inboxItem: { read: true, readAt: serverTime() },
    notifySettings: { push: false, pushKinds: [] },
};

/** The fields of a collection's client update other than the stamp (what `EDITS` must cover). */
export function editableFields(collection: ClientCollection): string[] {
    return CLIENT_WRITES[collection].update.filter((field) => field !== 'updatedBy' && field !== 'updatedAt');
}
