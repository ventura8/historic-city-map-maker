/**
 * The city roles' helpers of the admins page (M5, `docs/research/M5-interfaces.md` §1.7; behaviour A51): the current
 * city's name in each language (its id until the session named it) and whether the signed-in admin owns it.
 */
import { describe, expect, it } from 'vitest';

import { currentCityName, ownsCurrentCity, rowDetail } from '../../../src/admin/admins/roles.js';
import { adminState } from '../shell/fake-app.js';

describe('the city roles', () => {
    it('happyPath_theCitysNameInEachLanguageAndItsOwner', () => {
        const cluj = adminState({ cities: [{ id: 'cluj', role: 'owner', name: { ro: 'Cluj-Napoca' } }], cityId: 'cluj' });

        expect([currentCityName(adminState(), 'en'), currentCityName(adminState(), 'ro'), currentCityName(cluj, 'en')]).toEqual([
            'Bucharest',
            'București',
            'Cluj-Napoca',
        ]);
        expect(ownsCurrentCity(cluj)).toBe(true);
        expect(rowDetail('en', { role: 'owner', projectOwner: true, self: true })).toBe('Owner · The project’s owner · You');
    });

    it('badPath_aCityTheSessionDidNotNameShowsItsIdAndNoStateNothing', () => {
        const unnamed = adminState({ cities: [], cityId: 'bacau' });

        expect([
            currentCityName(unnamed, 'ro'),
            currentCityName(null, 'en'),
            currentCityName(adminState({ cities: [], cityId: null }), 'en'),
        ]).toEqual(['bacau', '', '']);
        expect([ownsCurrentCity(unnamed), ownsCurrentCity(null)]).toEqual([false, false]);
        expect(rowDetail('ro', { role: 'editor', projectOwner: false, self: false })).toBe('Editor');
    });
});
