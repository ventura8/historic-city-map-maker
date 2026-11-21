/**
 * The admins area as its page reads it (`docs/research/M2c-interfaces.md` §9.1; M5 `docs/research/M5-interfaces.md`
 * §1.7: the current city's admins and their roles), mirroring `packages/admin/src/admins/admins.ts` (checked at compile
 * time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { CityAdminsListResponse, CityRole, InviteResponse } from '@hcm/shared';

import type { AdminNoticeInputPort, AdminOutcomePort } from '../notice-port.js';
import type { LoadStatusPort } from '../area-port.js';

export type AdminSelectionPort =
    { readonly kind: 'admin'; readonly uid: string } | { readonly kind: 'invite'; readonly inviteId: string } | null;

/** A removal of the current city (the store adds the city). */
export type RevokeInputPort = { readonly kind: 'admin'; readonly uid: string } | { readonly kind: 'invite'; readonly inviteId: string };

export interface AdminsViewState {
    readonly status: LoadStatusPort;
    readonly list: CityAdminsListResponse | null;
    readonly failure: AdminNoticeInputPort | null;
    readonly selected: AdminSelectionPort;
    readonly invited: InviteResponse | null;
    readonly busy: boolean;
}

export interface AdminsIntentsPort {
    refresh(): Promise<void>;
    invite(email: string, role?: CityRole): Promise<AdminOutcomePort<InviteResponse>>;
    revoke(request: RevokeInputPort): Promise<AdminOutcomePort<{ readonly revoked: true }>>;
    setRole(uid: string, role: CityRole): Promise<AdminOutcomePort<{ readonly role: CityRole }>>;
    dismissInvited(): void;
}
