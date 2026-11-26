/**
 * The rules mirror `CLIENT_WRITES` (packages/shared/src/schemas/client-writes.ts) field by field: for every
 * client-writable collection, an admin may change each field its `update` list names (and the result passes the zod
 * schema), never a field outside it (server-owned), and a create may carry exactly its `create` list. The fields come
 * from the shared contract, so a field added to a schema or to `CLIENT_WRITES` fails here until the rules follow.
 */
import {
    CLIENT_WRITES,
    FIRESTORE_PATHS,
    cityDocSchema,
    inboxItemDocSchema,
    jobDocSchema,
    notifySettingsDocSchema,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    storyDocSchema,
    usgsSceneDocSchema,
    type ClientCollection,
} from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    EDITS,
    cityDoc,
    inboxItemDoc,
    jobDoc,
    layerDoc,
    newJob,
    newNotifySettings,
    newPhoto,
    newPoi,
    photoDoc,
    notifySettingsDoc,
    poiDoc,
    usgsSceneDoc,
} from './support/documents.js';
import { newPoiCategory, poiCategoryDoc } from './support/poi-categories.js';
import { newStory, storyDoc } from './support/stories.js';
import { createWorld, deleted, stampedBy, verdict, type Data, type Verdict, type World } from './support/world.js';

/** What the tests need of a zod object schema. */
interface DocumentSchema {
    readonly shape: object;
    safeParse(value: unknown): { readonly error?: { readonly issues: readonly unknown[] } | undefined };
}

interface Collection {
    readonly schema: DocumentSchema;
    /** The path of a fresh document of this collection. */
    path(id: string): string;
    /** The complete server document. */
    complete(): Data;
    /** The admin's create, when clients create this collection. */
    create?: (uid: string) => Data;
    /** A collection of one document per admin (M4's push settings): the create test removes what an update test left. */
    readonly single?: boolean;
}

const CITY_ID = 'rules-client-writes';

let world: World;
let sequence = 0;

const admin = (): string => world.uid('admin');

const COLLECTIONS: Readonly<Record<ClientCollection, Collection>> = {
    city: { schema: cityDocSchema, path: (id) => FIRESTORE_PATHS.city(`${CITY_ID}-${id}`), complete: () => cityDoc(CITY_ID) },
    photo: {
        schema: photoDocSchema,
        path: (id) => FIRESTORE_PATHS.photo(CITY_ID, id),
        complete: () => photoDoc(CITY_ID, 'p0', admin()),
        create: newPhoto,
    },
    layer: { schema: layerDocSchema, path: (id) => FIRESTORE_PATHS.layer(CITY_ID, id), complete: layerDoc },
    poi: { schema: poiDocSchema, path: (id) => FIRESTORE_PATHS.poi(CITY_ID, id), complete: () => poiDoc(admin()), create: newPoi },
    poiCategory: {
        schema: poiCategoryDocSchema,
        path: (id) => FIRESTORE_PATHS.poiCategory(CITY_ID, id),
        complete: poiCategoryDoc,
        create: newPoiCategory,
    },
    story: {
        schema: storyDocSchema,
        path: (id) => FIRESTORE_PATHS.story(CITY_ID, id),
        complete: () => storyDoc(admin()),
        create: newStory,
    },
    // A frame parked for points: both client writes of a job (a cancellation, the georeferencer's mark) are allowed on it.
    job: {
        schema: jobDocSchema,
        path: (id) => FIRESTORE_PATHS.job(CITY_ID, id),
        complete: () => jobDoc(admin(), 'awaiting_gcps'),
        create: newJob,
    },
    usgsScene: { schema: usgsSceneDocSchema, path: (id) => FIRESTORE_PATHS.usgsScene(CITY_ID, id), complete: () => usgsSceneDoc() },
    // M4: an admin's own inbox and push settings (docs/research/M4-interfaces.md §5.6).
    inboxItem: {
        schema: inboxItemDocSchema,
        path: (id) => FIRESTORE_PATHS.inboxItem(admin(), `job.failed~writes~${id}~0`),
        complete: inboxItemDoc,
    },
    notifySettings: {
        schema: notifySettingsDocSchema,
        path: () => FIRESTORE_PATHS.notifySettings(admin()),
        complete: () => notifySettingsDoc(admin()),
        create: newNotifySettings,
        single: true,
    },
};

const NAMES = Object.keys(CLIENT_WRITES) as ClientCollection[];

function serverOwned(name: ClientCollection, writable: readonly string[]): string[] {
    return Object.keys(COLLECTIONS[name].schema.shape).filter((field) => !writable.includes(field));
}

function cases(name: ClientCollection, fields: readonly string[]): [ClientCollection, string][] {
    return fields.map((field) => [name, field]);
}

/** Seeds the complete document at a fresh path and sends the admin's stamped update. */
async function adminUpdate(name: ClientCollection, changes: Data): Promise<{ path: string; result: Verdict }> {
    sequence += 1;
    const collection = COLLECTIONS[name];
    const path = collection.path(`w${String(sequence)}`);
    await world.seed(path, collection.complete());
    const result = await verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(admin()), ...changes }),
    );
    return { path, result };
}

async function readBack(name: ClientCollection, path: string): Promise<readonly unknown[]> {
    const snapshot = await world.db('admin').doc(path).get();
    return COLLECTIONS[name].schema.safeParse(snapshot.data()).error?.issues ?? [];
}

beforeAll(async () => {
    world = await createWorld('writes');
    await world.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc(CITY_ID));
});

afterAll(async () => {
    await world.close();
});

describe('update', () => {
    const editable = NAMES.flatMap((name) => cases(name, Object.keys(EDITS[name])));
    const owned = NAMES.flatMap((name) => cases(name, serverOwned(name, CLIENT_WRITES[name].update)));

    it.each(editable)('happyPath_an%sEditOf_%s_IsAllowedAndSchemaValid', async (name, field) => {
        const value: unknown = EDITS[name][field];
        const { path, result } = await adminUpdate(name, { [field]: value });

        expect(result).toBe('allow');
        expect(await readBack(name, path)).toEqual([]);
    });

    it.each(owned)('badPath_a%sServerOwnedField_%s_IsNeverChangedOrRemoved', async (name, field) => {
        const changed = await adminUpdate(name, { [field]: 'forged' });
        const removed = await adminUpdate(name, { [field]: deleted() });

        expect({ changed: changed.result, removed: removed.result }).toEqual({ changed: 'deny', removed: 'deny' });
    });

    it.each(NAMES)('badPath_a%sUpdateCannotAddAnUnknownField', async (name) => {
        expect((await adminUpdate(name, { unknownField: true })).result).toBe('deny');
    });
});

describe('create', () => {
    const creatable = NAMES.filter((name) => CLIENT_WRITES[name].create.length > 0);
    const owned = creatable.flatMap((name) => cases(name, serverOwned(name, CLIENT_WRITES[name].create)));

    it.each(creatable)('happyPath_an%sCreateWithEveryClientFieldIsAllowedAndSchemaValid', async (name) => {
        const collection = COLLECTIONS[name];
        const path = collection.path(`c${name}`);
        if (collection.single === true) {
            await world.env.withSecurityRulesDisabled((owner) => owner.firestore().doc(path).delete());
        }

        const result = await verdict(
            world
                .db('admin')
                .doc(path)
                .set(collection.create?.(admin()) ?? {}),
        );

        expect(result).toBe('allow');
        expect(await readBack(name, path)).toEqual([]);
    });

    it.each(owned)('badPath_a%sCreateCannotCarryTheServerOwnedField_%s', async (name, field) => {
        sequence += 1;
        const collection = COLLECTIONS[name];
        const create = { ...(collection.create?.(admin()) ?? {}), [field]: collection.complete()[field] as unknown };

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(collection.path(`c${String(sequence)}`))
                    .set(create),
            ),
        ).toBe('deny');
    });
});
