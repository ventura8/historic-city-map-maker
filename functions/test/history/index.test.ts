/** The `history` family: exactly the registry's history functions, each trigger on its registry source. */
import { BACKGROUND_FUNCTIONS, CALLABLES } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { historyFunctions } from '../../src/history/index.js';
import { registryKeys, sorted } from '../admin/world.js';

describe('history family', () => {
    it('happyPath_theTriggersWatchTheirRegistrySourcesWithTheWritersIdentity', () => {
        const family = historyFunctions((): never => {
            throw new Error('the dependencies are created by the first event, never when the functions are defined');
        });

        const expected = [
            ...registryKeys(Object.keys(CALLABLES), 'history'),
            ...registryKeys(Object.keys(BACKGROUND_FUNCTIONS), 'history'),
        ];
        expect(sorted(Object.keys(family))).toEqual(sorted(expected));
        expect(family.onPoiWrite.__endpoint.eventTrigger).toMatchObject({
            eventType: 'google.cloud.firestore.document.v1.written.withAuthContext',
            eventFilterPathPatterns: { document: BACKGROUND_FUNCTIONS['history.onPoiWrite'].source },
            retry: false,
        });
        expect(family.onCityWrite.__endpoint.eventTrigger?.eventFilterPathPatterns).toEqual({ document: 'cities/{city}' });
    });
});
