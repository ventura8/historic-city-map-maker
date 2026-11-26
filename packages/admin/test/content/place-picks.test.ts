// The places a photo's or a map's place picker offers (M17 §12): every place once, by Romanian title; an uploader's own only.
import { describe, expect, it } from 'vitest';

import { readPlacePicks } from '../../src/content/place-picks.js';
import { READ_WAIT_MS } from '../../src/content/read-once.js';
import { seedPlace } from '../pois/world.js';
import { contentWorld } from './world.js';

describe('readPlacePicks', () => {
    it('happyPath_everyPlaceOnceSortedByItsRomanianTitle', async () => {
        const world = contentWorld();
        seedPlace(world, 'stavropoleos');
        seedPlace(world, 'ateneu', { title: { ro: 'Ateneul Român' } });

        expect(await readPlacePicks(world.services)).toEqual([
            { id: 'ateneu', title: { ro: 'Ateneul Român' } },
            { id: 'stavropoleos', title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' } },
        ]);
    });

    it('happyPath_anUploaderIsOfferedTheirOwnPlacesOnly', async () => {
        const world = contentWorld({ cityRole: () => 'uploader' });
        seedPlace(world, 'mine', { createdBy: 'admin-uid' });
        seedPlace(world, 'theirs', { createdBy: 'someone-else' });

        expect((await readPlacePicks(world.services))?.map((pick) => pick.id)).toEqual(['mine']);
    });

    it('badPath_noAnswerLeavesThePickerOff', async () => {
        const world = contentWorld();
        world.store.setOffline(true);
        const pending = readPlacePicks(world.services);
        world.clock.advance(READ_WAIT_MS);

        expect(await pending).toBeNull();
    });
});
