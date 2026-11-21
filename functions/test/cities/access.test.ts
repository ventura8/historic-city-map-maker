/**
 * Every city callable closes the city to the admins of other cities (M5-interfaces §1.3): the registry's accesses, the
 * check after validation and before the handler, and the documents from before M5 (S-A51-*).
 */
import { CALLABLES, CITY_ACCESSES, type CallableName } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { requireCityRole, type VerifiedCaller } from '../../src/api/access.js';
import { runCallable } from '../../src/api/callable.js';
import { fakeAdmins, fakeMembership, recordingLogger } from '../support/fakes.js';
import { googleToken } from '../admin/world.js';

const CITY_CALLABLES = (Object.keys(CALLABLES) as CallableName[]).filter((name) => CITY_ACCESSES.includes(CALLABLES[name].access));

/** An editor of the second city only. */
const OUTSIDER: VerifiedCaller = {
    uid: 'u-cluj',
    email: undefined,
    claim: true,
    membership: fakeMembership({ projectRole: 'admin', cities: { cluj: 'editor' } }),
};

describe('the city callables', () => {
    it.each(CITY_CALLABLES)('badPath_%s_refusesAnAdminOfAnotherCity @S-A51-BAD-OTHER-CITY-CALLABLE', (name) => {
        expect(() => {
            requireCityRole(CALLABLES[name].access, OUTSIDER, { cityId: 'bucharest' });
        }).toThrow(expect.objectContaining({ code: 'apiError.city.notMember', params: { cityId: 'bucharest' } }));
    });

    it('badPath_theHandlerNeverRunsForAnotherCitysAdmin @S-A51-BAD-OTHER-CITY-CALLABLE', async () => {
        const ran: string[] = [];
        const deps = { ...recordingLogger(), admins: fakeAdmins(['u-cluj'], { projectRole: 'admin', cities: { cluj: 'owner' } }) };
        const auth = { uid: 'u-cluj', token: googleToken('cluj@example.test', { admin: true }) };
        const handler = () => {
            ran.push('handler');
            return Promise.resolve({ revoked: true as const });
        };

        const refused = runCallable('admins.revoke', handler, deps, { auth, data: { kind: 'admin', cityId: 'bucharest', uid: 'u-x' } });
        await expect(refused).rejects.toMatchObject({ code: 'apiError.city.notMember' });
        await expect(
            runCallable('admins.revoke', handler, deps, { auth, data: { kind: 'admin', cityId: 'cluj', uid: 'u-x' } }),
        ).resolves.toEqual({ revoked: true });

        expect(ran).toEqual(['handler']);
    });

    it('badPath_anAdminDocumentWithoutCitiesIsNoMemberUntilMigrated', () => {
        const legacy: VerifiedCaller = { ...OUTSIDER, membership: fakeMembership({ projectRole: 'admin', cities: {} }) };

        expect(() => {
            requireCityRole('cityEditor', legacy, { cityId: 'cluj' });
        }).toThrow(expect.objectContaining({ code: 'apiError.city.notMember' }));
    });
});
