/**
 * The allow/deny matrix of firebase/firestore.rules: every persona × every collection × get, list, create, update and
 * delete (docs/research/M2-interfaces.md §2.1, CLIENT_WRITES). Writes send a valid payload stamped by the persona, so
 * a denial comes from who is asking or from the collection being server-owned, never from a malformed value; the
 * value checks are in the per-entity files.
 */
import { FIRESTORE_PATHS, type AuditedDocument } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    adminDoc,
    aiUsageDoc,
    cityDoc,
    geocodeCellDoc,
    harvestStateDoc,
    historyEntryDoc,
    inboxItemDoc,
    inviteDoc,
    jobDoc,
    jobLogDoc,
    layerDoc,
    layerVersionDoc,
    manifestStateDoc,
    notificationEventDoc,
    notifySettingsDoc,
    newJob,
    newNotifySettings,
    newPhoto,
    newPoi,
    newPoiCategory,
    opsGuardDoc,
    ownerDoc,
    photoDoc,
    poiCategoryDoc,
    poiDoc,
    pushDeviceDoc,
    setupStatusDoc,
    usageDoc,
    usgsSceneDoc,
    workerDoc,
} from './support/documents.js';
import { countrySourcesDoc, opsDispatchDoc } from './support/server-documents.js';
import {
    ADMIN_ONLY,
    ANY_ADMIN,
    EVERYONE,
    NOBODY,
    createWorld,
    expected,
    past,
    serverTime,
    stampedBy,
    systemStamp,
    verdicts,
    type Data,
    type Persona,
    type World,
} from './support/world.js';

type Operation = 'get' | 'list' | 'create' | 'update' | 'delete';

const OPERATIONS: readonly Operation[] = ['get', 'list', 'create', 'update', 'delete'];
const CITY_ID = 'matrix-city';
const INVITE_ID = 'cd'.repeat(32);

interface Row {
    readonly collection: string;
    /** The id of the seeded document (update and delete use their own copies). */
    readonly id: string;
    readonly seed: () => Data;
    readonly create: (uid: string) => Data;
    readonly update: (uid: string) => Data;
    readonly allowed: Partial<Record<Operation, readonly Persona[]>>;
}

let world: World;

const admin = (): string => world.uid('admin');
const stamped = (changes: Data) => (uid: string) => ({ ...changes, ...stampedBy(uid) });
const readOnly = { get: ADMIN_ONLY, list: ADMIN_ONLY };
const everything = { get: ADMIN_ONLY, list: ADMIN_ONLY, create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY };

function audited(entity: AuditedDocument['entity'], entityId: string): string {
    return FIRESTORE_PATHS.history({ entity, cityId: CITY_ID, entityId });
}

/** A server-written, client-read-only collection. */
function serverOwned(collection: string, id: string, seed: () => Data): Row {
    return {
        collection,
        id,
        seed,
        create: (uid) => ({ ...seed(), ...stampedBy(uid) }),
        update: stamped({ forged: true }),
        allowed: readOnly,
    };
}

/** A server-written document of the project, not of a city (M5): every admin reads it, whatever their cities. */
function projectOwned(collection: string, id: string, seed: () => Data): Row {
    return { ...serverOwned(collection, id, seed), allowed: { get: ANY_ADMIN, list: ANY_ADMIN } };
}

function history(collection: string): Row {
    return serverOwned(collection, '1767225600000-event1', () => historyEntryDoc(admin()));
}

/** The admin persona's uid in this world (`createWorld('matrix')`): its own inbox, settings and devices (M4). */
const OWN = 'matrix-admin';

const ROWS: Readonly<Record<string, Row>> = {
    'admins/{uid}': serverOwned(FIRESTORE_PATHS.admins, 'someone-else', adminDoc),
    'setup/status': projectOwned('setup', 'status', setupStatusDoc),
    'setup/owner': projectOwned('setup', 'owner', () => ownerDoc(admin())),
    // M28: where each country keeps its old maps and images (ops.tick writes it; Setup's Sources step reads it).
    'countrySources/{country}': projectOwned(FIRESTORE_PATHS.countrySources, 'RO', countrySourcesDoc),
    'invites/{sha256}': serverOwned(FIRESTORE_PATHS.invites, INVITE_ID, () => inviteDoc(admin())),
    'usage/{month}': projectOwned('usage', 'mapbox-2026-10', usageDoc),
    // M5: the ops documents are read one by one (their rule names the document), never listed.
    'ops/guard': { ...projectOwned('ops', 'guard', opsGuardDoc), allowed: { get: ANY_ADMIN } },
    'ops/dispatch': { ...projectOwned('ops', 'dispatch', opsDispatchDoc), allowed: { get: ANY_ADMIN } },
    // M5: a city's harvest state and manifest state are its admins' (get only: the rule names the city).
    'ops/harvest-{city}': { ...serverOwned('ops', `harvest-${CITY_ID}`, harvestStateDoc), allowed: { get: ADMIN_ONLY } },
    'manifests/{city}': {
        ...serverOwned(FIRESTORE_PATHS.manifestStates, CITY_ID, () => manifestStateDoc(CITY_ID)),
        allowed: { get: ADMIN_ONLY },
    },
    'cities/{city}': {
        collection: 'cities',
        id: CITY_ID,
        seed: () => cityDoc(CITY_ID),
        create: (uid) => ({ ...cityDoc(CITY_ID), ...stampedBy(uid) }),
        update: stamped({ published: false }),
        // M5: a city is read and updated by its own admins; the cities are never listed (the rule names the city).
        allowed: { get: ADMIN_ONLY, update: ADMIN_ONLY },
    },
    'cities/{city}/photos/{photo}': {
        collection: FIRESTORE_PATHS.photos(CITY_ID),
        id: 'p1',
        seed: () => photoDoc(CITY_ID, 'p1', admin()),
        create: newPhoto,
        update: stamped({ bearing: 180 }),
        allowed: everything,
    },
    'cities/{city}/layers/{layer}': {
        collection: FIRESTORE_PATHS.layers(CITY_ID),
        id: 'corona-1966',
        seed: layerDoc,
        create: (uid) => ({ ...layerDoc(), ...stampedBy(uid) }),
        update: stamped({ opacity: 0.5 }),
        allowed: { ...readOnly, update: ADMIN_ONLY },
    },
    'cities/{city}/pois/{poi}': {
        collection: FIRESTORE_PATHS.pois(CITY_ID),
        id: 'enei',
        seed: () => poiDoc(admin()),
        create: newPoi,
        update: stamped({ published: false }),
        allowed: everything,
    },
    'cities/{city}/poiCategories/{category}': {
        collection: FIRESTORE_PATHS.poiCategories(CITY_ID),
        id: 'cladiri',
        seed: poiCategoryDoc,
        create: newPoiCategory,
        update: stamped({ order: 5 }),
        allowed: everything,
    },
    'cities/{city}/jobs/{job}': {
        collection: FIRESTORE_PATHS.jobs(CITY_ID),
        id: 'j1',
        seed: () => jobDoc(admin()),
        create: newJob,
        update: stamped({ cancelRequested: true }),
        allowed: { ...readOnly, update: ADMIN_ONLY },
    },
    'cities/{city}/layerVersions/{version}': serverOwned(FIRESTORE_PATHS.layerVersions(CITY_ID), 'job-1966', layerVersionDoc),
    'cities/{city}/jobs/{job}/logs/{line}': serverOwned(FIRESTORE_PATHS.jobLogs(CITY_ID, 'j1'), '000001', jobLogDoc),
    'cities/{city}/usgsScenes/{scene}': {
        collection: FIRESTORE_PATHS.usgsScenes(CITY_ID),
        id: 'DS1034-1057DA024',
        seed: () => usgsSceneDoc(),
        create: (uid) => ({ ...usgsSceneDoc(), ...stampedBy(uid) }),
        // M4: the client's triage is candidate or rejected; an order is usgs.markOrdered's (docs/research/M4-interfaces.md §1.8).
        update: stamped({ status: 'rejected' }),
        allowed: { ...readOnly, update: ADMIN_ONLY },
    },
    // M5 (docs/research/M5-interfaces.md §1.8, §5.3): the city's counters and its exports' records, server-written.
    'cities/{city}/usage/{month}': serverOwned(`${FIRESTORE_PATHS.city(CITY_ID)}/usage`, '2026-10', () => ({
        month: '2026-10',
        computeUnits: 1,
        aiRequests: 2,
        ...systemStamp('cities'),
    })),
    'cities/{city}/exports/{export}': serverOwned(FIRESTORE_PATHS.cityExports(CITY_ID), 'export-1', () => ({
        status: 'queued',
        ...systemStamp('export'),
    })),
    // M8 (docs/research/M8-join-interfaces.md §2): the plan of whole-city dates, written by the imagery functions only.
    'cities/{city}/imageryPlans/{id}': serverOwned(`${FIRESTORE_PATHS.city(CITY_ID)}/imageryPlans`, 'dates', () => ({
        rows: [],
        updatedAt: past(),
    })),
    // M9 (docs/research/M9-calibration.md §2): a pass's last proved model has no client rule at all: the pipeline alone reads it.
    'cities/{city}/imageryPasses/{key}': {
        ...serverOwned(FIRESTORE_PATHS.imageryPasses(CITY_ID), 'D3C1203-300415-F-1975-08-20', () => ({
            model: { camera: 'panoramic', rotation: 0, mirrored: false, scale: 0.94, rotationDeg: 0, dxM: 1830, dyM: 13869 },
            entityId: 'D3C1203-300415F006',
            date: '1975-08-20',
            ...systemStamp('imagery'),
        })),
        allowed: {},
    },
    // M20 (docs/research/M20-import-local.md §2.3, §2.4): a local archive's report, its skipped sample, the city's grids, server-written.
    'cities/{city}/archives/{archive}': serverOwned(FIRESTORE_PATHS.archives(CITY_ID), 'ar-0123456789abcdef', () => ({
        name: 'harti.zip',
        source: 'zip',
        fileCount: 1,
        bytes: 1,
        series: [],
        skipped: {},
        ...systemStamp('imagery'),
    })),
    'cities/{city}/archives/{archive}/issues/{issue}': serverOwned(
        FIRESTORE_PATHS.archiveIssues(CITY_ID, 'ar-0123456789abcdef'),
        '000',
        () => ({ path: 'x/Thumbs.db', reason: 'not-a-map' }),
    ),
    'cities/{city}/grids/{grid}': serverOwned(FIRESTORE_PATHS.grids(CITY_ID), 'bucharest', () => ({
        label: 'Bucharest grid',
        grammar: 'bucharest',
        cellM: 500,
        ...systemStamp('imagery'),
    })),
    // M7 (docs/research/M7-local-worker.md §2.4, §3): the city's local workers and run choice, server-written.
    'cities/{city}/workers/{doc}': serverOwned(FIRESTORE_PATHS.workers(CITY_ID), 'w-0123456789abcdef', () => workerDoc(admin())),
    // Finding 67 of 2026-11-02: the worker pairings (a code's hash, its owner, its image) have no client rule at all.
    'cities/{city}/pairings/{pair}': {
        ...serverOwned(FIRESTORE_PATHS.pairings(CITY_ID), 'a'.repeat(40), () => ({
            uid: 'u-owner',
            expiresAt: serverTime(),
            ...systemStamp('imagery'),
        })),
        allowed: {},
    },
    'cities/{city}/history/{entry}': history(audited('city', CITY_ID)),
    'cities/{city}/photos/{photo}/history/{entry}': history(audited('photo', 'p1')),
    'cities/{city}/layers/{layer}/history/{entry}': history(audited('layer', 'corona-1966')),
    'cities/{city}/pois/{poi}/history/{entry}': history(audited('poi', 'enei')),
    'cities/{city}/poiCategories/{category}/history/{entry}': history(audited('poiCategory', 'cladiri')),
    // Ground control points return with their schema in M3; until then the default deny holds.
    'cities/{city}/gcps/{layer}': { ...serverOwned(`cities/${CITY_ID}/gcps`, 'corona-1966', layerDoc), allowed: {} },
    'secrets/{name}': { ...serverOwned('secrets', 'mapbox-sk-bootstrap', usageDoc), allowed: {} },
    // M4 (docs/research/M4-interfaces.md §4.2, §5.6; assists-notify): the admin's own inbox (marked read), settings (one
    // document, `settings`, written in its own tests: a copy under another id is refused) and devices; the events have no
    // client rule; the geocoding cache, the AI counters and the M4 ops documents are read-only.
    'admins/{uid}/inbox/{item}': {
        collection: FIRESTORE_PATHS.inbox(OWN),
        id: 'job.failed~matrix-city~j1~0',
        seed: () => ({ ...inboxItemDoc(), read: false }),
        create: (uid) => ({ ...inboxItemDoc(), ...stampedBy(uid) }),
        update: stamped({ read: true, readAt: serverTime() }),
        allowed: { ...readOnly, update: ADMIN_ONLY },
    },
    'admins/{uid}/notify/{doc}': {
        collection: `admins/${OWN}/notify`,
        id: 'settings',
        seed: () => notifySettingsDoc(OWN),
        create: newNotifySettings,
        update: stamped({ push: false }),
        allowed: readOnly,
    },
    'admins/{uid}/pushDevices/{device}': serverOwned(FIRESTORE_PATHS.pushDevices(OWN), 'ab'.repeat(16), () => pushDeviceDoc(OWN)),
    'notificationEvents/{event}': {
        ...serverOwned(FIRESTORE_PATHS.notificationEvents, 'job.failed~matrix-city~j1~0', notificationEventDoc),
        allowed: {},
    },
    'assistGeocodes/{cell}': projectOwned(FIRESTORE_PATHS.geocodeCells, 'n444413_e260973', geocodeCellDoc),
    'usage/ai-{month}': projectOwned('usage', 'ai-2026-10', aiUsageDoc),
};

function request(row: Row, operation: Operation, persona: Persona): Promise<unknown> {
    const db = world.db(persona);
    const copy = db.doc(`${row.collection}/${row.id}-${operation}`);
    switch (operation) {
        case 'get':
            return db.doc(`${row.collection}/${row.id}`).get();
        case 'list':
            return db.collection(row.collection).get();
        case 'create':
            return db.doc(`${row.collection}/new-${persona}`).set(row.create(world.uid(persona)));
        case 'update':
            return copy.update(row.update(world.uid(persona)));
        case 'delete':
            return copy.delete();
    }
}

beforeAll(async () => {
    world = await createWorld('matrix');
    await world.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc(CITY_ID));
    const seeds = Object.values(ROWS).flatMap((row) =>
        ['', '-update', '-delete'].map((suffix) => world.seed(`${row.collection}/${row.id}${suffix}`, row.seed())),
    );
    await Promise.all(seeds);
});

afterAll(async () => {
    await world.close();
});

describe.each(Object.entries(ROWS))('%s', (_name, row) => {
    it.each(OPERATIONS)('matrix_%s', async (operation) => {
        const result = await verdicts(EVERYONE, (persona) => request(row, operation, persona));

        expect(result).toEqual(expected(EVERYONE, row.allowed[operation] ?? NOBODY));
    });
});
