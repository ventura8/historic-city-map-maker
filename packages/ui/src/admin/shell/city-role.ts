/** The signed-in admin's role in the open city, or null (M13, `docs/research/M13-roles.md` §1): the screens follow the rules' roles. */
import type { CityRole } from '@hcm/shared';

import type { AdminStatePort } from '../admin-port.js';

export function cityRoleOfState(state: AdminStatePort | null): CityRole | null {
    return state?.cities?.find((city) => city.id === state.cityId)?.role ?? null;
}
