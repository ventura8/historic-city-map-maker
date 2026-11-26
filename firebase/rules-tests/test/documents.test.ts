/**
 * The test documents are the contract's documents (no emulator needed): every complete fixture passes its zod
 * schema and carries every key the schema knows, every client create sends exactly `CLIENT_WRITES[entity].create`,
 * and `EDITS` covers exactly `CLIENT_WRITES[entity].update` with values the schema accepts. A field added to a
 * document schema or to `CLIENT_WRITES` therefore fails here first, then in the rules tests until the rules follow.
 */
import {
    CLIENT_WRITES,
    adminDocSchema,
    aiUsageDocSchema,
    geocodeCellDocSchema,
    inboxItemDocSchema,
    notificationEventDocSchema,
    notifySettingsDocSchema,
    pushDeviceDocSchema,
    runChoiceDocSchema,
    workerDocSchema,
    cityDocSchema,
    historyEntryDocSchema,
    inviteDocSchema,
    jobDocSchema,
    harvestStateDocSchema,
    jobLogDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    manifestStateDocSchema,
    opsDispatchDocSchema,
    opsGuardDocSchema,
    ownerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    setupStatusDocSchema,
    usageDocSchema,
    usgsSceneDocSchema,
    type ClientCollection,
} from '@hcm/shared';
import { countrySourcesDocSchema } from '@hcm/shared/sources';
import firebase from 'firebase/compat/app';
import { describe, expect, it } from 'vitest';

import {
    EDITS,
    adminDoc,
    aiUsageDoc,
    geocodeCellDoc,
    inboxItemDoc,
    newNotifySettings,
    notificationEventDoc,
    notifySettingsDoc,
    pushDeviceDoc,
    runChoiceDoc,
    workerDoc,
    cityDoc,
    editableFields,
    harvestStateDoc,
    historyEntryDoc,
    inviteDoc,
    jobDoc,
    jobLogDoc,
    layerDoc,
    layerVersionDoc,
    manifestStateDoc,
    newPhoto,
    newPoi,
    newPoiCategory,
    opsGuardDoc,
    ownerDoc,
    photoDoc,
    poiCategoryDoc,
    poiDoc,
    setupStatusDoc,
    usageDoc,
    usgsSceneDoc,
} from './support/documents.js';
import { countrySourcesDoc, opsDispatchDoc } from './support/server-documents.js';
import { past, type Data } from './support/world.js';

/** What the tests need of a zod object schema. */
interface DocumentSchema {
    readonly shape: object;
    safeParse(value: unknown): { readonly error?: { readonly issues: readonly unknown[] } | undefined };
}

const CITY_ID = 'rules-documents';
const UID = 'documents-admin';

/** The complete server document of every client-writable collection, with its schema. */
const COMPLETE: readonly (readonly [ClientCollection, DocumentSchema, () => Data])[] = [
    ['city', cityDocSchema, () => cityDoc(CITY_ID)],
    ['photo', photoDocSchema, () => photoDoc(CITY_ID, 'p1', UID)],
    ['layer', layerDocSchema, layerDoc],
    ['poi', poiDocSchema, () => poiDoc(UID)],
    ['poiCategory', poiCategoryDocSchema, poiCategoryDoc],
    ['job', jobDocSchema, () => jobDoc(UID)],
    ['usgsScene', usgsSceneDocSchema, () => usgsSceneDoc()],
    ['inboxItem', inboxItemDocSchema, inboxItemDoc],
    ['notifySettings', notifySettingsDocSchema, () => notifySettingsDoc(UID)],
];

/** The client creates, by collection (jobs are created by the imagery functions since M3, CR-M3-2). */
const CREATES: readonly (readonly [ClientCollection, DocumentSchema, (uid: string) => Data])[] = [
    ['photo', photoDocSchema, newPhoto],
    ['poi', poiDocSchema, newPoi],
    ['poiCategory', poiCategoryDocSchema, newPoiCategory],
    ['notifySettings', notifySettingsDocSchema, newNotifySettings],
];

/** The server-owned documents the tests seed. */
const SERVER_ONLY: readonly (readonly [string, DocumentSchema, () => Data])[] = [
    ['job log', jobLogDocSchema, jobLogDoc],
    ['layer version', layerVersionDocSchema, layerVersionDoc],
    ['history entry', historyEntryDocSchema, () => historyEntryDoc(UID)],
    ['admin', adminDocSchema, adminDoc],
    ['invite', inviteDocSchema, () => inviteDoc(UID)],
    ['owner', ownerDocSchema, () => ownerDoc(UID)],
    ['setup status', setupStatusDocSchema, setupStatusDoc],
    ['country sources', countrySourcesDocSchema, countrySourcesDoc],
    ['usage', usageDocSchema, usageDoc],
    ['ops guard', opsGuardDocSchema, opsGuardDoc],
    ['dispatch slots', opsDispatchDocSchema, opsDispatchDoc],
    ['harvest state', harvestStateDocSchema, harvestStateDoc],
    ['manifest state', manifestStateDocSchema, () => manifestStateDoc(CITY_ID)],
    ['push device', pushDeviceDocSchema, () => pushDeviceDoc(UID)],
    ['notification event', notificationEventDocSchema, notificationEventDoc],
    ['geocode cell', geocodeCellDocSchema, geocodeCellDoc],
    ['AI usage', aiUsageDocSchema, aiUsageDoc],
    ['local worker', workerDocSchema, () => workerDoc(UID)],
    ['run choice', runChoiceDocSchema, () => runChoiceDoc(UID)],
];

/** A client document as Firestore stores it: `serverTimestamp()` becomes a timestamp. */
function stored(data: Data): Data {
    const entries = Object.entries(data).map(([key, value]: [string, unknown]): [string, unknown] => [
        key,
        value instanceof firebase.firestore.FieldValue ? past() : value,
    ]);
    return Object.fromEntries(entries);
}

function issues(schema: DocumentSchema, data: Data): readonly unknown[] {
    return schema.safeParse(data).error?.issues ?? [];
}

function sorted(keys: Iterable<string>): string[] {
    return [...keys].sort((left, right) => left.localeCompare(right));
}

describe('complete server documents', () => {
    it.each(COMPLETE)('happyPath_the%sFixturePassesItsSchemaWithEveryField', (_collection, schema, document) => {
        const data = document();

        expect(issues(schema, data)).toEqual([]);
        expect(sorted(Object.keys(data))).toEqual(sorted(Object.keys(schema.shape)));
    });

    it.each(SERVER_ONLY)('happyPath_theSeeded%sPassesItsSchema', (_name, schema, document) => {
        expect(issues(schema, document())).toEqual([]);
    });

    it('badPath_aStrictSchemaRefusesAnUnknownField', () => {
        expect(issues(photoDocSchema, { ...photoDoc(CITY_ID, 'p1', UID), html: '<b>x</b>' })).not.toEqual([]);
    });
});

describe('client creates', () => {
    it.each(CREATES)('happyPath_a%sCreateSendsExactlyTheClientFields', (collection, schema, create) => {
        const data = create(UID);

        expect(sorted(Object.keys(data))).toEqual(sorted(CLIENT_WRITES[collection].create));
        expect(issues(schema, stored(data))).toEqual([]);
    });

    it('badPath_collectionsWithoutAClientCreateAreCreatedByTheServer', () => {
        const serverCreated = Object.entries(CLIENT_WRITES).flatMap(([collection, writes]) =>
            writes.create.length === 0 ? [collection] : [],
        );

        expect(sorted(serverCreated)).toEqual(['city', 'inboxItem', 'job', 'layer', 'usgsScene']);
    });
});

describe('client edits', () => {
    it.each(COMPLETE)('happyPath_EDITSCoverEvery%sFieldAClientMayUpdate', (collection) => {
        expect(sorted(Object.keys(EDITS[collection]))).toEqual(sorted(editableFields(collection)));
    });

    it.each(COMPLETE)('happyPath_every%sEditKeepsTheDocumentValid', (collection, schema, document) => {
        // An edit to the server's time (`serverTimestamp()`, M4's `readAt`) is checked as the timestamp Firestore stores.
        const failures = Object.entries(EDITS[collection]).filter(
            ([field, value]: [string, unknown]) => issues(schema, stored({ ...document(), [field]: value })).length > 0,
        );

        expect(failures).toEqual([]);
    });

    it('badPath_everyClientUpdateCarriesTheStamp', () => {
        const unstamped = Object.entries(CLIENT_WRITES).filter(
            ([, writes]) => !writes.update.includes('updatedBy') || !writes.update.includes('updatedAt'),
        );

        expect(unstamped).toEqual([]);
    });
});
