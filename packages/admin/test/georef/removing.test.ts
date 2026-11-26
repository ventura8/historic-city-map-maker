// Removing a pair (`removing.ts`): it goes in one Undo step and a notice offers Undo, which puts that very pair back where it was
// (S-A16-HAPPY-GEOREF-REMOVE-UNDO); a pair that is not there, or an admin who may not edit, removes nothing
// (S-A16-BAD-GEOREF-REMOVE-NOTHING).
import type { Gcp } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GEOREF_MODULE } from '../../src/georef/georef.js';
import { removePair, withRestored, type RemovingHost } from '../../src/georef/removing.js';
import type { ContentNotice } from '../../src/content/services.js';
import { settle } from '../app/fakes.js';
import { golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { pair } from './fixtures.js';

function hostOf(
    start: readonly Gcp[],
    readOnly = false,
): { readonly host: RemovingHost; readonly notices: ContentNotice[]; pairs: readonly Gcp[] } {
    const notices: ContentNotice[] = [];
    const world = {
        notices,
        pairs: start,
        host: {
            services: { notify: (notice: ContentNotice) => notices.push(notice), readOnly: () => readOnly },
            pairs: () => world.pairs,
            edit: (pairs: readonly Gcp[]) => {
                world.pairs = pairs;
            },
        },
    };
    return world;
}

const G1 = pair('g1', 0, 0);
const G2 = pair('g2', 100, 0);
const G3 = pair('g3', 0, 100);
const THREE = [G1, G2, G3];

describe('removing a pair', () => {
    it('happyPath_thePairGoesAndTheNoticesUndoPutsItBackWhereItWas @S-A16-HAPPY-GEOREF-REMOVE-UNDO', () => {
        const world = hostOf(THREE);

        removePair(world.host, 'g2');
        expect(world.pairs.map((item) => item.id)).toEqual(['g1', 'g3']);
        expect(world.notices).toMatchObject([
            { key: 'adminContent.georef.pairRemoved', params: { number: '2' }, action: { key: 'adminContent.georef.pairRemovedUndo' } },
        ]);

        // Another pair was added since: Undo still brings this one back, second in the list.
        world.pairs = [...world.pairs, pair('g4', 50, 50)];
        world.notices[0]?.action?.run();
        expect(world.pairs.map((item) => item.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
        expect(world.pairs[1]).toEqual(G2);
        // Undo twice (the notice clicked again, or the page's own Undo first): the pair is there once.
        world.notices[0]?.action?.run();
        expect(world.pairs).toHaveLength(4);
        // A list that got shorter meanwhile takes it at its end.
        expect(withRestored([G1], G3, 2).map((item) => item.id)).toEqual(['g1', 'g3']);
    });

    it('badPath_aPairThatIsNotThereOrAnAdminWhoMayNotEditRemovesNothing @S-A16-BAD-GEOREF-REMOVE-NOTHING', () => {
        const world = hostOf(THREE);
        removePair(world.host, 'g9');
        expect([world.pairs, world.notices]).toEqual([THREE, []]);

        const locked = hostOf(THREE, true);
        removePair(locked.host, 'g1');
        expect([locked.pairs, locked.notices]).toEqual([THREE, []]);
    });

    it('happyPath_throughTheStoreARemovedPairComesBackWithTheNoticesUndo @S-A16-HAPPY-GEOREF-REMOVE-UNDO', async () => {
        const world = imageryWorld();
        world.store.docs.set(VERSIONS('job-1966-0712'), golden('version.awaiting-approval.json'));
        const georef = GEOREF_MODULE.create(world.services);
        georef.open(['job-1966-0712']);
        await settle();
        const before = georef.state.pairs;
        const third = before[2]?.id ?? '';

        georef.intents.remove(third);
        expect(georef.state.pairs.map((item) => item.id)).not.toContain(third);
        expect([georef.state.dirty, georef.state.canUndo]).toEqual([true, true]);
        expect(world.notices.at(-1)).toMatchObject({ key: 'adminContent.georef.pairRemoved', params: { number: '3' } });

        world.notices.at(-1)?.action?.run();
        expect(georef.state.pairs.map((item) => item.id)).toEqual(before.map((item) => item.id));
        expect(georef.state.dirty).toBe(false);
    });
});
