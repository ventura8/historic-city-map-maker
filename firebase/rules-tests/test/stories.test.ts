/**
 * M17's stories (docs/research/M17-stories.md §2): `cities/{city}/stories/{story}` as places are, for every actor (nobody, a
 * stranger, an uploader, another uploader, a moderator, an editor, an owner, another city's owner), and the value checks of
 * `validStory` (the title, the text's size, the years, the links' counts).
 */
import type { TokenOptions } from '@firebase/rules-unit-testing';
import { FIRESTORE_PATHS } from '@hcm/shared';
import type firebase from 'firebase/compat/app';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cityDoc } from './support/documents.js';
import { newStory, storyDoc } from './support/stories.js';
import { createWorld, past, stampedBy, type Data, type World } from './support/world.js';

const SCOPE = 'stories';
const CITY = `${SCOPE}-city`;
const OTHER = `${SCOPE}-other`;

const ACTORS = ['anonymous', 'stranger', 'uploader', 'otherUploader', 'moderator', 'editor', 'owner', 'otherCity'] as const;
type Actor = (typeof ACTORS)[number];

const GOOGLE: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const ROLES: Readonly<Partial<Record<Actor, Data>>> = {
    uploader: { [CITY]: 'uploader' },
    otherUploader: { [CITY]: 'uploader' },
    moderator: { [CITY]: 'moderator' },
    editor: { [CITY]: 'editor' },
    owner: { [CITY]: 'owner' },
    otherCity: { [OTHER]: 'owner' },
};

const REVIEWERS: readonly Actor[] = ['moderator', 'editor', 'owner'];
const STAFF: readonly Actor[] = ['editor', 'owner'];

const uid = (actor: Actor): string => `${SCOPE}-${actor}`;

let world: World;

function dbOf(actor: Actor): firebase.firestore.Firestore {
    if (actor === 'anonymous') {
        return world.env.unauthenticatedContext().firestore();
    }
    const claims = ROLES[actor] === undefined ? GOOGLE : { ...GOOGLE, admin: true };
    return world.env.authenticatedContext(uid(actor), claims).firestore();
}

async function outcome(run: () => Promise<unknown>): Promise<'allow' | 'deny'> {
    try {
        await run();
        return 'allow';
    } catch (error) {
        if (String((error as { readonly code?: string }).code).includes('permission-denied')) {
            return 'deny';
        }
        throw error;
    }
}

const pending = (creator: Actor): Data => ({ ...storyDoc(uid(creator)), published: false, reviewStatus: 'pending' });
const edit = (actor: Actor, changes: Data): Data => ({ ...changes, ...stampedBy(uid(actor)) });

async function fresh(id: string, data: Data): Promise<string> {
    const target = FIRESTORE_PATHS.story(CITY, id);
    await world.seed(target, data);
    return target;
}

interface Row {
    readonly name: string;
    readonly allowed: readonly Actor[];
    readonly run: (actor: Actor, step: string) => Promise<unknown>;
}

const ROWS: readonly Row[] = [
    { name: 'every story', allowed: REVIEWERS, run: (a) => dbOf(a).collection(FIRESTORE_PATHS.stories(CITY)).get() },
    {
        name: 'their own stories',
        allowed: ['uploader', 'otherUploader', ...REVIEWERS],
        run: (a) => dbOf(a).collection(FIRESTORE_PATHS.stories(CITY)).where('createdBy', '==', uid(a)).get(),
    },
    {
        name: 'a story that does not exist yet',
        allowed: ['uploader', 'otherUploader', ...REVIEWERS],
        run: (a) => dbOf(a).doc(FIRESTORE_PATHS.story(CITY, 'not-yet')).get(),
    },
    {
        name: "a story's history",
        allowed: REVIEWERS,
        run: (a) =>
            dbOf(a)
                .collection(`${FIRESTORE_PATHS.story(CITY, 'approved')}/history`)
                .get(),
    },
    {
        name: 'a new published story',
        allowed: STAFF,
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.story(CITY, s))
                .set({ ...newStory(uid(a)), published: true }),
    },
    {
        name: 'a new story waiting for review',
        allowed: ['uploader', 'otherUploader'],
        run: (a, s) =>
            dbOf(a)
                .doc(FIRESTORE_PATHS.story(CITY, s))
                .set({ ...newStory(uid(a)), reviewStatus: 'pending' }),
    },
    {
        name: "an approved story's text",
        allowed: REVIEWERS,
        run: async (a, s) =>
            dbOf(a)
                .doc(await fresh(s, storyDoc(uid('uploader'))))
                .update(edit(a, { body: { ro: 'Altfel.' } })),
    },
    {
        name: "the uploader's waiting story's text",
        allowed: ['uploader', ...REVIEWERS],
        run: async (a, s) =>
            dbOf(a)
                .doc(await fresh(s, pending('uploader')))
                .update(edit(a, { title: { ro: 'Nou' } })),
    },
    {
        name: 'publishing a waiting story directly',
        allowed: [],
        run: async (a, s) =>
            dbOf(a)
                .doc(await fresh(s, pending('uploader')))
                .update(edit(a, { published: true })),
    },
    {
        name: 'approving a waiting story directly',
        allowed: [],
        run: async (a, s) =>
            dbOf(a)
                .doc(await fresh(s, pending('uploader')))
                .update(edit(a, { reviewStatus: 'approved' })),
    },
    {
        name: 'deleting an approved story',
        allowed: STAFF,
        run: async (a, s) =>
            dbOf(a)
                .doc(await fresh(s, storyDoc(uid('uploader'))))
                .delete(),
    },
    {
        name: "deleting the uploader's waiting story",
        allowed: ['uploader', ...STAFF],
        run: async (a, s) =>
            dbOf(a)
                .doc(await fresh(s, pending('uploader')))
                .delete(),
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
    await world.seed(FIRESTORE_PATHS.story(CITY, 'approved'), storyDoc(uid('uploader')));
});

afterAll(async () => {
    await world.close();
});

describe.each(ACTORS)('M17 stories: %s @S-A100-HAPPY-RULES @S-A100-BAD-RULES', (actor) => {
    it.each(ROWS)('$name', async (row) => {
        const step = `s${String(ROWS.indexOf(row))}-${actor}`.slice(0, 40);
        expect(await outcome(() => row.run(actor, step))).toBe(row.allowed.includes(actor) ? 'allow' : 'deny');
    });
});

describe('M17 stories: the values', () => {
    const create = (changes: Data, step: string, left: readonly string[] = []) =>
        outcome(() => {
            const story = Object.entries({ ...newStory(uid('editor')), ...changes }).filter(([key]) => !left.includes(key));
            return dbOf('editor').doc(FIRESTORE_PATHS.story(CITY, step)).set(Object.fromEntries(story));
        });

    it('happyPath_aStoryWithoutTextOrLinksIsADraft', async () => {
        expect(await create({ yearStart: 1900, yearEnd: 1900 }, 'v-draft', ['body', 'photoIds', 'poiIds', 'credit'])).toBe('allow');
    });

    it.each([
        ['a blank title', { title: { ro: ' ' } }],
        ['a text over 10 000 characters', { body: { ro: 'x'.repeat(10_001) } }],
        ['an inverted span', { yearStart: 1950, yearEnd: 1900 }],
        ['a year before 1800', { yearStart: 1799 }],
        ['21 photos', { photoIds: Array.from({ length: 21 }, (_, index) => `p${String(index)}`) }],
        ['21 places', { poiIds: Array.from({ length: 21 }, (_, index) => `x${String(index)}`) }],
        ['a field nobody writes', { reviewNote: 'Bună.' }],
    ])('badPath_refuses %s', async (_name, changes) => {
        expect(await create(changes, `v-${String(Object.keys(changes)[0])}`)).toBe('deny');
    });
});
