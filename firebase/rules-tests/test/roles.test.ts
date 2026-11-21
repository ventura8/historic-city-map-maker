/**
 * M13's roles in both directions (docs/research/M13-roles.md §1): each actor (nobody, a stranger, an account with a document
 * but no role here, an uploader, another uploader, a moderator, an editor, an owner and another city's owner) against every
 * path and operation the roles touch. The rules are the enforcement, so what each screen hides is proved here.
 */
import type { TokenOptions } from '@firebase/rules-unit-testing';
import { FIRESTORE_PATHS } from '@hcm/shared';
import firebase from 'firebase/compat/app';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cityDoc, layerDoc, newPhoto, newPoi, photoDoc, poiCategoryDoc, poiDoc } from './support/documents.js';
import { createWorld, past, serverTime, stampedBy, type Data, type World } from './support/world.js';

const SCOPE = 'roles';
const CITY = `${SCOPE}-city`;
const OTHER = `${SCOPE}-other`;

const ACTORS = ['anonymous', 'stranger', 'noRole', 'uploader', 'otherUploader', 'moderator', 'editor', 'owner', 'otherCity'] as const;
type Actor = (typeof ACTORS)[number];

const GOOGLE: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const ROLES: Readonly<Partial<Record<Actor, Data>>> = {
    noRole: {},
    uploader: { [CITY]: 'uploader' },
    otherUploader: { [CITY]: 'uploader' },
    moderator: { [CITY]: 'moderator' },
    editor: { [CITY]: 'editor' },
    owner: { [CITY]: 'owner' },
    otherCity: { [OTHER]: 'owner' },
};

const uid = (actor: Actor): string => `${SCOPE}-${actor}`;

let world: World;

function dbOf(actor: Actor): firebase.firestore.Firestore {
    if (actor === 'anonymous') {
        return world.env.unauthenticatedContext().firestore();
    }
    const claims = ROLES[actor] === undefined ? GOOGLE : { ...GOOGLE, admin: true };
    return world.env.authenticatedContext(uid(actor), claims).firestore();
}

function storageOf(actor: Actor): firebase.storage.Storage {
    if (actor === 'anonymous') {
        return world.env.unauthenticatedContext().storage();
    }
    const claims = ROLES[actor] === undefined ? GOOGLE : { ...GOOGLE, admin: true };
    return world.env.authenticatedContext(uid(actor), claims).storage();
}

async function outcome(run: () => Promise<unknown>): Promise<'allow' | 'deny'> {
    try {
        await run();
        return 'allow';
    } catch (error) {
        const code = (error as { readonly code?: string }).code ?? '';
        if (code.includes('permission-denied') || code.includes('unauthorized') || code.includes('PERMISSION_DENIED')) {
            return 'deny';
        }
        throw error;
    }
}

/** One row: what `run` does as each actor, and the actors who may. */
interface Row {
    readonly name: string;
    readonly allowed: readonly Actor[];
    readonly run: (actor: Actor, step: string) => Promise<unknown>;
}

const SERVER_ONLY: readonly Actor[] = [];
const REVIEWERS: readonly Actor[] = ['moderator', 'editor', 'owner'];
const STAFF: readonly Actor[] = ['editor', 'owner'];
const IN_CITY: readonly Actor[] = ['uploader', 'otherUploader', 'moderator', 'editor', 'owner'];
const PROJECT_STAFF: readonly Actor[] = ['noRole', 'editor', 'owner', 'otherCity'];

const path = {
    approved: FIRESTORE_PATHS.photo(CITY, 'approved'),
    pendingOwn: FIRESTORE_PATHS.photo(CITY, 'pending'),
    staff: FIRESTORE_PATHS.photo(CITY, 'staff'),
    refusedOwn: FIRESTORE_PATHS.photo(CITY, 'refused'),
    poiApproved: FIRESTORE_PATHS.poi(CITY, 'approved'),
    poiPending: FIRESTORE_PATHS.poi(CITY, 'pending'),
};

/** A fresh document per actor and step, so one actor's delete leaves the next actor's row as it was. */
async function freshPhoto(id: string, data: Data): Promise<string> {
    const target = FIRESTORE_PATHS.photo(CITY, id);
    await world.seed(target, data);
    return target;
}

async function freshPoi(id: string, data: Data): Promise<string> {
    const target = FIRESTORE_PATHS.poi(CITY, id);
    await world.seed(target, data);
    return target;
}

/** `data` without `keys`. */
function without(data: Data, ...keys: readonly string[]): Data {
    return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
}

function seededPending(creator: Actor): Data {
    return { ...without(photoDoc(CITY, 'x', uid(creator)), 'image'), published: false, reviewStatus: 'pending' };
}

const pendingPoi = (creator: Actor): Data => ({ ...poiDoc(uid(creator)), published: false, reviewStatus: 'pending' });

/** An uploader's create: `newPhoto` (every field a client may send) without the legacy id, which is never theirs. */
function uploaderPhoto(actor: Actor): Data {
    return { ...without(newPhoto(uid(actor)), 'legacyId'), reviewStatus: 'pending' };
}

const uploaderPoi = (actor: Actor): Data => ({ ...newPoi(uid(actor)), reviewStatus: 'pending', category: 'cat' });

const edit = (actor: Actor, changes: Data): Data => ({ ...changes, ...stampedBy(uid(actor)) });

const READS: readonly Row[] = [
    { name: 'the city', allowed: IN_CITY, run: (a) => dbOf(a).doc(FIRESTORE_PATHS.city(CITY)).get() },
    { name: 'its manifest build', allowed: IN_CITY, run: (a) => dbOf(a).doc(FIRESTORE_PATHS.manifestState(CITY)).get() },
    { name: 'its categories', allowed: IN_CITY, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.poiCategories(CITY)).get() },
    { name: "the uploader's approved photo", allowed: ['uploader', ...REVIEWERS], run: (a) => dbOf(a).doc(path.approved).get() },
    { name: "staff's photo", allowed: REVIEWERS, run: (a) => dbOf(a).doc(path.staff).get() },
    { name: "the uploader's pending photo", allowed: ['uploader', ...REVIEWERS], run: (a) => dbOf(a).doc(path.pendingOwn).get() },
    { name: 'every photo', allowed: REVIEWERS, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.photos(CITY)).get() },
    {
        name: "the uploader's own photos",
        allowed: ['uploader', 'otherUploader', ...REVIEWERS],
        run: (a) => dbOf(a).collection(FIRESTORE_PATHS.photos(CITY)).where('createdBy', '==', uid(a)).get(),
    },
    { name: 'every place', allowed: REVIEWERS, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.pois(CITY)).get() },
    {
        name: "the uploader's own places",
        allowed: ['uploader', 'otherUploader', ...REVIEWERS],
        run: (a) => dbOf(a).collection(FIRESTORE_PATHS.pois(CITY)).where('createdBy', '==', uid(a)).get(),
    },
    {
        name: "a photo's history",
        allowed: REVIEWERS,
        run: (a) => dbOf(a).collection(`${path.approved}/history`).get(),
    },
    { name: "a place's history", allowed: REVIEWERS, run: (a) => dbOf(a).collection(`${path.poiApproved}/history`).get() },
    {
        name: "the city's own history",
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .collection(`${FIRESTORE_PATHS.city(CITY)}/history`)
                .get(),
    },
    {
        name: 'recent changes',
        allowed: STAFF,
        run: (a) => dbOf(a).collectionGroup('history').where('cityId', '==', CITY).get(),
    },
    { name: 'layers', allowed: STAFF, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.layers(CITY)).get() },
    { name: 'jobs', allowed: STAFF, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.jobs(CITY)).get() },
    { name: 'layer versions', allowed: STAFF, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.layerVersions(CITY)).get() },
    { name: 'USGS scenes', allowed: STAFF, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.usgsScenes(CITY)).get() },
    {
        name: "the city's usage",
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .collection(`${FIRESTORE_PATHS.city(CITY)}/usage`)
                .get(),
    },
    {
        name: 'exports',
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .collection(`${FIRESTORE_PATHS.city(CITY)}/exports`)
                .get(),
    },
    {
        name: 'workers',
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .collection(`${FIRESTORE_PATHS.city(CITY)}/workers`)
                .get(),
    },
    { name: 'suggestions', allowed: REVIEWERS, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.suggestions(CITY)).get() },
    { name: 'contributors', allowed: REVIEWERS, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.contributors(CITY)).get() },
    { name: 'role requests', allowed: ['owner'], run: (a) => dbOf(a).collection(FIRESTORE_PATHS.roleRequests(CITY)).get() },
    { name: 'Setup', allowed: PROJECT_STAFF, run: (a) => dbOf(a).doc(FIRESTORE_PATHS.setupStatus).get() },
    { name: 'the budget guard', allowed: PROJECT_STAFF, run: (a) => dbOf(a).doc('ops/guard').get() },
    { name: 'the project usage', allowed: PROJECT_STAFF, run: (a) => dbOf(a).doc('usage/mapbox-2026-11').get() },
    { name: "the assists' cache", allowed: PROJECT_STAFF, run: (a) => dbOf(a).doc('assistGeocodes/cell').get() },
];

const WRITES: readonly Row[] = [
    {
        name: 'settings',
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.city(CITY))
                .update(edit(a, { published: true })),
    },
    {
        name: 'a layer',
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.layer(CITY, 'l1'))
                .update(edit(a, { opacity: 0.5 })),
    },
    {
        name: 'a category',
        allowed: STAFF,
        run: (a) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.poiCategory(CITY, 'cat'))
                .update(edit(a, { order: 3 })),
    },
    {
        name: 'a new photo as staff',
        allowed: STAFF,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set(newPhoto(uid(a))),
    },
    {
        name: 'a new photo marked pending',
        allowed: ['uploader', 'otherUploader'],
        run: (a, s) => dbOf(a).doc(FIRESTORE_PATHS.photo(CITY, s)).set(uploaderPhoto(a)),
    },
    {
        name: 'a new photo with no location',
        allowed: ['uploader', 'otherUploader'],
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set(without(uploaderPhoto(a), 'location', 'bearing', 'fov')),
    },
    {
        name: "staff's new photo with no location",
        allowed: STAFF,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set(without(newPhoto(uid(a)), 'location', 'bearing', 'fov')),
    },
    {
        name: "an uploader's update aiming their own unplaced photo @S-A94-BAD-AIMED-UNPLACED",
        allowed: SERVER_ONLY,
        run: async (a, s) => {
            const target = await freshPhoto(`aim-${a}-${s}`, without(seededPending('uploader'), 'location', 'bearing', 'fov'));
            await dbOf(a)
                .doc(target)
                .update(edit(a, { bearing: 90 }));
        },
    },
    {
        name: 'a field of view added to an unplaced photo',
        allowed: SERVER_ONLY,
        run: async (a, s) => {
            const target = await freshPhoto(`fov-${a}-${s}`, without(seededPending('uploader'), 'location', 'bearing', 'fov'));
            await dbOf(a)
                .doc(target)
                .update(edit(a, { fov: 60 }));
        },
    },
    {
        name: "a reviewer's update aiming a staff photo with no place",
        allowed: SERVER_ONLY,
        run: async (a, s) => {
            const target = await freshPhoto(`aim2-${a}-${s}`, without(photoDoc(CITY, 'x', uid('editor')), 'location', 'bearing', 'fov'));
            await dbOf(a)
                .doc(target)
                .update(edit(a, { bearing: 90 }));
        },
    },
    {
        name: "an uploader's update placing and aiming their own photo",
        allowed: ['uploader', ...REVIEWERS],
        run: async (a, s) => {
            const target = await freshPhoto(`aim3-${a}-${s}`, without(seededPending('uploader'), 'location', 'bearing', 'fov'));
            await dbOf(a)
                .doc(target)
                .update(edit(a, { location: { lat: 44.43, lng: 26.09 }, bearing: 90 }));
        },
    },
    {
        name: 'a direction with no location',
        allowed: SERVER_ONLY,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set(without(uploaderPhoto(a), 'location')),
    },
    {
        name: 'a field of view with no location, as staff',
        allowed: SERVER_ONLY,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set(without(newPhoto(uid(a)), 'location', 'bearing')),
    },
    {
        name: 'a new photo calling itself approved',
        allowed: SERVER_ONLY,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set({ ...uploaderPhoto(a), reviewStatus: 'approved' }),
    },
    {
        name: 'a new photo already published',
        allowed: SERVER_ONLY,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set({ ...uploaderPhoto(a), published: true }),
    },
    {
        name: 'a pending photo with a legacy id',
        allowed: SERVER_ONLY,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.photo(CITY, s))
                .set({ ...uploaderPhoto(a), legacyId: 'old' }),
    },
    {
        name: 'a new place as staff',
        allowed: STAFF,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.poi(CITY, s))
                .set({ ...newPoi(uid(a)), category: 'cat' }),
    },
    {
        name: 'a new place marked pending',
        allowed: ['uploader', 'otherUploader'],
        run: (a, s) => dbOf(a).doc(FIRESTORE_PATHS.poi(CITY, s)).set(uploaderPoi(a)),
    },
    {
        name: 'a new place already published',
        allowed: SERVER_ONLY,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.poi(CITY, s))
                .set({ ...uploaderPoi(a), published: true }),
    },
    {
        name: 'a staff place published at once',
        allowed: STAFF,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.poi(CITY, s))
                .set({ ...newPoi(uid(a)), category: 'cat', published: true }),
    },
    {
        name: "an approved photo's title",
        allowed: REVIEWERS,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, photoDoc(CITY, s, uid('uploader'))))
                .update(edit(a, { title: { ro: 'Nou' } })),
    },
    {
        name: 'unpublishing an approved photo',
        allowed: REVIEWERS,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, { ...photoDoc(CITY, s, uid('uploader')), published: true }))
                .update(edit(a, { published: false })),
    },
    {
        name: "the uploader's pending photo's title",
        allowed: ['uploader', ...REVIEWERS],
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, seededPending('uploader')))
                .update(edit(a, { title: { ro: 'Nou' } })),
    },
    {
        name: 'publishing a pending photo directly',
        allowed: SERVER_ONLY,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, seededPending('uploader')))
                .update(edit(a, { published: true })),
    },
    {
        name: 'approving a photo directly',
        allowed: SERVER_ONLY,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, seededPending('uploader')))
                .update(edit(a, { reviewStatus: 'approved' })),
    },
    {
        name: "the uploader's refused photo's title",
        allowed: REVIEWERS,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, { ...seededPending('uploader'), reviewStatus: 'refused' }))
                .update(edit(a, { title: { ro: 'Nou' } })),
    },
    {
        name: 'publishing a refused photo directly',
        allowed: SERVER_ONLY,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, { ...seededPending('uploader'), reviewStatus: 'refused' }))
                .update(edit(a, { published: true })),
    },
    {
        name: 'giving a pending photo a rights mark',
        allowed: REVIEWERS,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, seededPending('uploader')))
                .update(edit(a, { rightsReview: true })),
    },
    {
        name: 'deleting an approved photo',
        allowed: STAFF,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, photoDoc(CITY, s, uid('uploader'))))
                .delete(),
    },
    {
        name: "deleting the uploader's pending photo",
        allowed: ['uploader', 'editor', 'owner'],
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, seededPending('uploader')))
                .delete(),
    },
    {
        name: "deleting the uploader's refused photo",
        allowed: ['uploader', 'editor', 'owner'],
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPhoto(s, { ...seededPending('uploader'), reviewStatus: 'refused' }))
                .delete(),
    },
    {
        name: "an approved place's title",
        allowed: REVIEWERS,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPoi(s, poiDoc(uid('uploader'))))
                .update(edit(a, { title: { ro: 'Nou' } })),
    },
    {
        name: "the uploader's pending place's title",
        allowed: ['uploader', ...REVIEWERS],
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPoi(s, pendingPoi('uploader')))
                .update(edit(a, { title: { ro: 'Nou' } })),
    },
    {
        name: 'publishing a pending place directly',
        allowed: SERVER_ONLY,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPoi(s, pendingPoi('uploader')))
                .update(edit(a, { published: true })),
    },
    {
        name: 'deleting an approved place',
        allowed: STAFF,
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPoi(s, poiDoc(uid('uploader'))))
                .delete(),
    },
    {
        name: "deleting the uploader's pending place",
        allowed: ['uploader', 'editor', 'owner'],
        run: async (a, s) =>
            dbOf(a)
                .doc(await freshPoi(s, pendingPoi('uploader')))
                .delete(),
    },
    {
        name: 'a suggestion',
        allowed: SERVER_ONLY,
        run: (a, s) => dbOf(a).doc(FIRESTORE_PATHS.suggestion(CITY, s)).set({ photoId: 'approved', updatedAt: serverTime() }),
    },
    {
        name: 'a contributor',
        allowed: SERVER_ONLY,
        run: (a) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.contributor(CITY, uid(a)))
                .set({ blocked: false }),
    },
    {
        name: 'a role request',
        allowed: SERVER_ONLY,
        run: (a) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.roleRequest(CITY, uid(a)))
                .set({ role: 'moderator' }),
    },
    {
        name: 'their own role',
        allowed: SERVER_ONLY,
        run: (a) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.admin(uid(a)))
                .set({ cities: { [CITY]: 'owner' } }),
    },
];

beforeAll(async () => {
    world = await createWorld(SCOPE);
    await Promise.all(
        Object.entries(ROLES).map(([actor, cities]) =>
            world.seed(FIRESTORE_PATHS.admin(uid(actor as Actor)), {
                role: 'admin',
                cities,
                email: `${actor}@example.org`,
                createdAt: past(),
                updatedBy: 'system:bootstrap',
                updatedAt: past(),
            }),
        ),
    );
    await world.seed(FIRESTORE_PATHS.city(CITY), cityDoc(CITY));
    await world.seed(FIRESTORE_PATHS.city(OTHER), cityDoc(OTHER));
    await world.seed(path.approved, photoDoc(CITY, 'approved', uid('uploader')));
    await world.seed(path.staff, photoDoc(CITY, 'staff', uid('editor')));
    await world.seed(path.pendingOwn, seededPending('uploader'));
    await world.seed(path.refusedOwn, { ...seededPending('uploader'), reviewStatus: 'refused' });
    await world.seed(path.poiApproved, poiDoc(uid('uploader')));
    await world.seed(path.poiPending, pendingPoi('uploader'));
    await world.seed(FIRESTORE_PATHS.layer(CITY, 'l1'), layerDoc());
    await world.seed(FIRESTORE_PATHS.poiCategory(CITY, 'cat'), poiCategoryDoc());
});

afterAll(async () => {
    await world.close();
});

describe.each(ACTORS)('M13 roles: %s @S-A94-HAPPY-MATRIX @S-A94-BAD-MATRIX', (actor) => {
    it.each(READS)('reads $name', async (row) => {
        expect(await outcome(() => row.run(actor, `r-${actor}`))).toBe(row.allowed.includes(actor) ? 'allow' : 'deny');
    });

    it.each(WRITES)('writes $name', async (row) => {
        const step = `w${String(WRITES.indexOf(row))}-${actor}`.slice(0, 40);
        expect(await outcome(() => row.run(actor, step))).toBe(row.allowed.includes(actor) ? 'allow' : 'deny');
    });
});

describe('M13 roles: a place of a photo', () => {
    it('never comes off through a client, whoever asks', async () => {
        const id = await freshPhoto('placed-a', photoDoc(CITY, 'placed-a', uid('editor')));
        const remove = (a: Actor) =>
            dbOf(a)
                .doc(id)
                .update(edit(a, { location: firebase.firestore.FieldValue.delete() }));
        expect(await outcome(() => remove('editor'))).toBe('deny');
        expect(await outcome(() => remove('moderator'))).toBe('deny');
    });

    it('outside the city is refused for an uploader as for an editor', async () => {
        const far = { location: { lat: 10, lng: 10 } };
        expect(
            await outcome(() =>
                dbOf('uploader')
                    .doc(FIRESTORE_PATHS.photo(CITY, 'far-u'))
                    .set({ ...uploaderPhoto('uploader'), ...far }),
            ),
        ).toBe('deny');
        expect(
            await outcome(() =>
                dbOf('editor')
                    .doc(FIRESTORE_PATHS.photo(CITY, 'far-e'))
                    .set({ ...newPhoto(uid('editor')), ...far }),
            ),
        ).toBe('deny');
    });
});

describe('M13 roles: Storage', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const META = { contentType: 'image/jpeg', customMetadata: { originalName: 'a.jpg' } };
    const upload = (a: Actor, photo: string, n: string) =>
        storageOf(a)
            .ref(`uploads/photos/${CITY}/${uid(a)}/${photo}/nonce${n}000.jpg`)
            .put(jpeg, META)
            .then(() => undefined);
    const seeded = async (id: string, data: Data): Promise<string> => {
        await freshPhoto(id, data);
        return id;
    };

    it.each(ACTORS)('%s uploads to a published photo only as a reviewer', async (actor) => {
        const id = await seeded(`up-a-${actor}`.slice(0, 40), photoDoc(CITY, 'x', uid('uploader')));
        expect(await outcome(() => upload(actor, id, 'a'))).toBe(REVIEWERS.includes(actor) ? 'allow' : 'deny');
    });

    it.each(ACTORS)("%s uploads to the uploader's pending photo only as that uploader or a reviewer", async (actor) => {
        const id = await seeded(`up-p-${actor}`.slice(0, 40), seededPending('uploader'));
        expect(await outcome(() => upload(actor, id, 'p'))).toBe(['uploader', ...REVIEWERS].includes(actor) ? 'allow' : 'deny');
    });

    it.each(ACTORS)('%s reads a held picture only with a right to it', async (actor) => {
        const id = await seeded(`held-${actor}`.slice(0, 40), seededPending('uploader'));
        await world.seedObject(`review-held/${CITY}/${id}/w.webp`, 'image/webp');
        const read = () => storageOf(actor).ref(`review-held/${CITY}/${id}/w.webp`).getMetadata();
        expect(await outcome(read)).toBe(['uploader', ...REVIEWERS].includes(actor) ? 'allow' : 'deny');
    });

    it.each(ACTORS)('%s reads an original only as a reviewer', async (actor) => {
        await world.seedObject(`originals/photos/${CITY}/o/${SCOPE}.jpg`, 'image/jpeg');
        const read = () => storageOf(actor).ref(`originals/photos/${CITY}/o/${SCOPE}.jpg`).getMetadata();
        expect(await outcome(read)).toBe(REVIEWERS.includes(actor) ? 'allow' : 'deny');
    });

    it.each(ACTORS)('%s uploads a raster only as staff', async (actor) => {
        const put = () =>
            storageOf(actor)
                .ref(`uploads/rasters/${CITY}/${uid(actor)}/r1/nonce${actor.slice(0, 3)}000.tif`)
                .put(jpeg, { contentType: 'image/tiff', customMetadata: { originalName: 'a.tif', year: '1966' } })
                .then(() => undefined);
        expect(await outcome(put)).toBe(STAFF.includes(actor) ? 'allow' : 'deny');
    });

    it.each(ACTORS)("%s reads the project's USGS copies only as staff", async (actor) => {
        await world.seedObject(`usgs-browse/${SCOPE}.jpg`, 'image/jpeg');
        const read = () => storageOf(actor).ref(`usgs-browse/${SCOPE}.jpg`).getMetadata();
        expect(await outcome(read)).toBe(PROJECT_STAFF.includes(actor) ? 'allow' : 'deny');
    });

    it.each(ACTORS)('%s deletes an upload only with a right to the folder', async (actor) => {
        const object = `uploads/photos/${CITY}/${uid('uploader')}/d1/del${actor.slice(0, 4)}0000.jpg`;
        await world.seedObject(object, 'image/jpeg');
        const remove = () => storageOf(actor).ref(object).delete();
        expect(await outcome(remove)).toBe(['uploader', ...REVIEWERS].includes(actor) ? 'allow' : 'deny');
    });
});
