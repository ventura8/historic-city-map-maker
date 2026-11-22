/**
 * An uploader's content create is transactional: it reads the destination before writing. Missing photo and POI
 * destinations therefore mirror stories, while the same reads stay closed to an account without the city's role.
 */
import type { TokenOptions } from '@firebase/rules-unit-testing';
import { FIRESTORE_PATHS } from '@hcm/shared';
import type firebase from 'firebase/compat/app';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cityDoc } from './support/documents.js';
import { createWorld, past, verdict, type World } from './support/world.js';

const SCOPE = 'uploader-create-read';
const CITY = `${SCOPE}-city`;
const UID = `${SCOPE}-uploader`;
const GOOGLE: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'google.com' }, admin: true };

let world: World;
let uploader: firebase.firestore.Firestore;

beforeAll(async () => {
    world = await createWorld(SCOPE);
    await world.seed(FIRESTORE_PATHS.city(CITY), cityDoc(CITY));
    await world.seed(FIRESTORE_PATHS.admin(UID), {
        role: 'admin',
        cities: { [CITY]: 'uploader' },
        email: 'uploader@example.org',
        createdAt: past(),
        updatedBy: 'system:test',
        updatedAt: past(),
    });
    uploader = world.env.authenticatedContext(UID, GOOGLE).firestore();
});

afterAll(async () => {
    await world.close();
});

describe.each([
    ['photo', FIRESTORE_PATHS.photo(CITY, 'not-yet')],
    ['place', FIRESTORE_PATHS.poi(CITY, 'not-yet')],
])('an uploader reads a missing %s destination', (_entity, path) => {
    it('happyPath_allowsTheTransactionalCreateRead', async () => {
        expect(await verdict(uploader.doc(path).get())).toBe('allow');
    });

    it('badPath_keepsTheMissingDestinationClosedWithoutTheCityRole', async () => {
        expect(await verdict(world.db('outsider').doc(path).get())).toBe('deny');
    });
});
