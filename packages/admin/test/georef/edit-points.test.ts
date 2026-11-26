// Edit points after a version is on the map: a published version opens with its pairs, editable (S-A16-HAPPY-EDIT-POINTS-PUBLISHED);
// one that ended, or is on its way to the map, takes none (S-A16-BAD-EDIT-POINTS-ENDED). Saving is `imagery.saveGcps`, which starts
// a new version of the same layer (`georef.test.ts`: the save of a rendered version).
import { describe, expect, it } from 'vitest';

import { GEOREF_MODULE } from '../../src/georef/georef.js';
import { settle } from '../app/fakes.js';
import { at, golden, imageryWorld, VERSIONS } from '../imagery/world.js';

const VERSION = 'job-1966-0712';

/** What each state's record carries beyond the rendered version's own fields (the tiles of a published one, who approved). */
const OWN = {
    path: `tiles/bucharest/kh-4a-corona-1966/${VERSION}.pmtiles`,
    url: 'https://tiles.example/x.pmtiles',
    bytes: 1000,
    publishedAt: at('2026-10-19T08:00:00Z'),
};
const APPROVAL = { auto: false, by: 'uid-owner', at: at('2026-10-19T07:00:00Z') };
const EXTRA: Readonly<Record<string, Record<string, unknown>>> = {
    published: { own: OWN, approval: APPROVAL },
    superseded: { own: OWN, approval: APPROVAL },
    approved: { approval: APPROVAL },
    publishing: { approval: APPROVAL },
    rejected: {},
};

async function openedAs(state: string) {
    const world = imageryWorld();
    world.store.docs.set(VERSIONS(VERSION), { ...golden('version.awaiting-approval.json'), ...EXTRA[state], state });
    const georef = GEOREF_MODULE.create(world.services);
    georef.open([VERSION]);
    await settle();
    return georef;
}

describe('edit points after approval', () => {
    it('happyPath_aPublishedVersionOpensWithItsPairsAndTakesNewOnes @S-A16-HAPPY-EDIT-POINTS-PUBLISHED', async () => {
        const georef = await openedAs('published');

        expect(georef.state.version).toMatchObject({ id: VERSION, state: 'published', editable: true });
        expect(georef.state.pairs).toHaveLength(8);
        const first = georef.state.pairs[0]?.id ?? '';
        georef.intents.movePixel(first, { x: 12, y: 34 });
        expect([georef.state.dirty, georef.state.pairs[0]?.pixel]).toEqual([true, { x: 12, y: 34 }]);
    });

    it('badPath_aVersionThatEndedOrIsOnItsWayToTheMapTakesNoPoints @S-A16-BAD-EDIT-POINTS-ENDED', async () => {
        for (const state of ['superseded', 'approved', 'publishing', 'rejected']) {
            const georef = await openedAs(state);
            expect([state, georef.state.version?.editable]).toEqual([state, false]);
        }
    });
});
