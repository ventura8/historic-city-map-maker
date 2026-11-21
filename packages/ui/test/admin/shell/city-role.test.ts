/** `cityRoleOfState` (M13): the signed-in admin's role in the open city, for the screens that follow the rules. */
import { describe, expect, it } from 'vitest';

import { cityRoleOfState } from '../../../src/admin/shell/city-role.js';
import { adminState } from './fake-app.js';

describe('cityRoleOfState', () => {
    it('happyPath_theOpenCitysRole', () => {
        const state = adminState({
            cityId: 'b',
            cities: [
                { id: 'a', role: 'owner', name: { ro: 'A' } },
                { id: 'b', role: 'uploader', name: { ro: 'B' } },
            ],
        });
        expect(cityRoleOfState(state)).toBe('uploader');
    });

    it('badPath_noStateOrNoSuchCity', () => {
        expect(cityRoleOfState(null)).toBeNull();
        expect(cityRoleOfState(adminState({ cityId: 'x', cities: [] }))).toBeNull();
    });
});
