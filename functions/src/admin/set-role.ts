import '../global-options.js';

import type { CallableRequest, CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { changeCityRole } from './memberships.js';

export type SetRoleDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type SetRoleRequest = CallableRequest<'admins.setRole'>;

/**
 * `admins.setRole` (a city's owner, new in M5; S-A51-HAPPY-ROLE, S-A51-BAD-LAST-OWNER, S-A51-BAD-ROLE-RACE,
 * S-A51-BAD-PROJECT-OWNER-STAYS): an admin's role in one city, their other cities untouched, in one transaction
 * (`changeCityRole`). Making the city's only owner an editor → `apiError.city.lastOwner`; the project's owner stays an
 * owner (`apiError.city.projectOwnerStays`); an account that is not the city's admin → `apiError.notFound`; the same
 * role again writes nothing.
 */
async function adminsSetRole(deps: SetRoleDeps, caller: VerifiedCaller, data: SetRoleRequest): Promise<CallableResponse<'admins.setRole'>> {
    const { before, after } = await changeCityRole(deps, { cityId: data.cityId, uid: data.uid, role: data.role, by: caller.uid });
    if (after !== before) {
        deps.log.info('city role changed', { by: caller.uid, cityId: data.cityId, uid: data.uid, role: data.role });
    }
    return { role: data.role };
}

/** The `admins-setRole` callable. */
export function setRoleFunction(getDeps: () => SetRoleDeps & CallableDeps) {
    return defineCallable('admins.setRole', adminsSetRole, getDeps);
}
