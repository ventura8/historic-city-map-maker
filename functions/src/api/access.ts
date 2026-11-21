import {
    CITY_ACCESSES,
    REVIEW_ROLES,
    STAFF_ROLES,
    WORKER_PAIR_ID_PATTERN,
    type ApiErrorCode,
    type CallableAccess,
    type CityRole,
} from '@hcm/shared';

import type { AdminDirectory, AdminMembership } from '../ports/admin-directory.js';
import { ApiError } from './api-error.js';

/** The claims of a verified Firebase ID token the access check reads (a subset of `DecodedIdToken`). */
export interface CallerToken {
    readonly email?: string;
    readonly email_verified?: boolean;
    readonly admin?: unknown;
    /** Finding 67: the developer claims of a paired worker's custom token (`worker.pair`). */
    readonly worker?: unknown;
    readonly city?: unknown;
    readonly pair?: unknown;
    readonly firebase: { readonly sign_in_provider: string };
}

/** `request.auth` of a callable: undefined when the caller is not signed in. */
export interface Caller {
    readonly uid: string;
    readonly token: CallerToken;
}

/** Who a handler acts for, once the access rule admitted them. */
export interface VerifiedCaller {
    readonly uid: string;
    /** The verified Google address of the ID token (`admin.claim` compares it, `admin.join` hashes it); never logged. */
    readonly email: string | undefined;
    /** The ID token carries `admin: true` (for `signedIn` callables, which also serve non-admins). */
    readonly claim: boolean;
    /** M5: the caller's project and city roles, read once by the access check of a city or project callable. */
    readonly membership?: AdminMembership;
    /** Finding 67: a paired worker's pairing and the one city its token is for (absent: a Google sign-in). */
    readonly worker?: { readonly pair: string; readonly city: string };
}

/** Who a callable of access `none` acts for (`worker.pair`): nobody signed in. */
const NOBODY: VerifiedCaller = { uid: '', email: undefined, claim: false };

/** firestore.rules `authed()`: a verified Google account (admins only ever sign in with Google). */
function isVerifiedGoogle(token: CallerToken): boolean {
    return token.email_verified === true && token.firebase.sign_in_provider === 'google.com';
}

/**
 * A paired worker's token (finding 67, `docs/research/M7-local-worker.md` §2.6): a custom-token sign-in whose claims
 * `worker: true`, `city` and `pair` `worker.pair` set. Only callables whose row says `workerToken` admit it; every other
 * callable (and the rules) wants a Google sign-in, so the token can do nothing else.
 */
const WORKER_TOKEN_RULES: readonly ((token: CallerToken) => boolean)[] = [
    (token) => token.firebase.sign_in_provider === 'custom',
    (token) => token.worker === true,
    (token) => typeof token.city === 'string',
    (token) => typeof token.pair === 'string' && WORKER_PAIR_ID_PATTERN.test(token.pair),
];

export function workerClaims(token: CallerToken): VerifiedCaller['worker'] {
    return WORKER_TOKEN_RULES.every((rule) => rule(token)) ? { pair: String(token.pair), city: String(token.city) } : undefined;
}

/** The claim AND the document; the document is read only when the token already qualifies. */
async function isAdmin(caller: Caller, admins: AdminDirectory): Promise<boolean> {
    return caller.token.admin === true && (await admins.isAdmin(caller.uid));
}

/** M13 §1: the claim and the document, read once, and not an account whose every role is `moderator` or `uploader`. */
async function isStaffAccount(caller: Caller, admins: AdminDirectory): Promise<boolean> {
    const membership = caller.token.admin === true ? await admins.membership(caller.uid) : null;
    return membership !== null && !membership.contributorOnly;
}

/** The membership behind an M5 access (`cityEditor`, `cityOwner`, `projectOwner`): the claim and the document. */
async function requireMembership(access: CallableAccess, caller: Caller, admins: AdminDirectory): Promise<AdminMembership> {
    const membership = caller.token.admin === true ? await admins.membership(caller.uid) : null;
    if (membership === null) {
        throw new ApiError('apiError.notAdmin');
    }
    if (access === 'projectOwner' && membership.projectRole !== 'owner') {
        throw new ApiError('apiError.city.notProjectOwner');
    }
    return membership;
}

/**
 * The access rule of a callable (`CALLABLES[name].access`), the same as the security rules: `signedIn` admits a
 * verified Google account, `admin` also needs the `admin` claim AND an `admins/{uid}` document, so deleting the
 * document revokes access at once although the claim stays in an ID token for up to an hour (S-A20-BAD-ADMIN-REMOVED).
 * M5's accesses read the document once (its membership) and `projectOwner` needs its `owner` role; the city of
 * `cityEditor` and `cityOwner` is checked by {@link requireCityRole} once the request is valid.
 */
export async function requireAccess(
    access: CallableAccess,
    caller: Caller | undefined,
    admins: AdminDirectory,
    readWorker: WorkerClaimsReader = noWorkerClaims,
): Promise<VerifiedCaller> {
    if (access === 'none') {
        return NOBODY;
    }
    if (caller === undefined) {
        throw new ApiError('apiError.unauthenticated');
    }
    const worker = readWorker(caller.token);
    return worker === undefined ? requireGoogle(access, caller, admins) : requireWorkerToken(access, caller, admins, worker);
}

/** How a callable reads a paired worker's claims: `workerClaims` where its row says `workerToken`, else none. */
export type WorkerClaimsReader = (token: CallerToken) => VerifiedCaller['worker'];

/** A callable that admits no paired worker. */
export function noWorkerClaims(): VerifiedCaller['worker'] {
    return undefined;
}

/** A paired worker: the owner it was paired for must still be a member (the city is checked with the request). */
async function requireWorkerToken(
    access: CallableAccess,
    caller: Caller,
    admins: AdminDirectory,
    worker: NonNullable<VerifiedCaller['worker']>,
): Promise<VerifiedCaller> {
    const membership = await requireMembership(access, caller, admins);
    return { uid: caller.uid, email: caller.token.email, claim: caller.token.admin === true, worker, membership };
}

/** A Google sign-in, as every callable but `worker.pair` and the worker's family with a paired token wants. */
async function requireGoogle(access: CallableAccess, caller: Caller, admins: AdminDirectory): Promise<VerifiedCaller> {
    if (!isVerifiedGoogle(caller.token)) {
        throw new ApiError('apiError.accountNotAllowed');
    }
    const verified = { uid: caller.uid, email: caller.token.email, claim: caller.token.admin === true };
    if (access === 'signedIn') {
        return verified;
    }
    if (access === 'admin' || access === 'member') {
        return requireAdmin(access, caller, admins, verified);
    }
    return { ...verified, membership: await requireMembership(access, caller, admins) };
}

/**
 * `member`: the claim and the document. `admin` (M13, `docs/research/M13-roles.md` §1) also refuses an account with cities and
 * none as staff, so a moderator or an uploader reaches none of the project's own state.
 */
async function requireAdmin(
    access: 'admin' | 'member',
    caller: Caller,
    admins: AdminDirectory,
    verified: VerifiedCaller,
): Promise<VerifiedCaller> {
    const allowed = access === 'member' ? await isAdmin(caller, admins) : await isStaffAccount(caller, admins);
    if (!allowed) {
        throw new ApiError('apiError.notAdmin');
    }
    return verified;
}

/** The `cityId` a valid request of a city callable names (the registry's test proves every one has it). */
function cityIdOf(request: unknown): string {
    const cityId = (request as { readonly cityId?: unknown }).cityId;
    if (typeof cityId !== 'string') {
        throw new ApiError('apiError.internal');
    }
    return cityId;
}

/**
 * M5 (`docs/research/M5-interfaces.md` §1.3; S-A51-BAD-OTHER-CITY-CALLABLE): after the request is validated and before
 * the handler reads or writes anything, `cityEditor` needs a role in the request's city (`apiError.city.notMember`) and
 * `cityOwner` its owner role (`apiError.city.notOwner`). Other accesses pass.
 */
export function requireCityRole(access: CallableAccess, caller: VerifiedCaller, request: unknown): void {
    if (CITY_ACCESSES.includes(access)) {
        const cityId = cityIdOf(request);
        requireRoleIn(cityId, roleOf(caller, cityId), access);
        requireWorkerCity(caller, cityId);
    }
}

/** A paired worker's token works for the one city it was paired for (finding 67). */
function requireWorkerCity(caller: VerifiedCaller, cityId: string): void {
    if (caller.worker !== undefined && caller.worker.city !== cityId) {
        throw new ApiError('apiError.city.notMember', { cityId });
    }
}

function roleOf(caller: VerifiedCaller, cityId: string): CityRole | null {
    return caller.membership?.roleIn(cityId) ?? null;
}

/** M13 §1: what each city access needs, named role by role, so a new role opens nothing it does not name. */
const CITY_ACCESS_ROLES: Readonly<
    Partial<Record<CallableAccess, { readonly roles: readonly CityRole[]; readonly refusal: ApiErrorCode }>>
> = {
    cityOwner: { roles: ['owner'], refusal: 'apiError.city.notOwner' },
    cityEditor: { roles: STAFF_ROLES, refusal: 'apiError.city.notEditor' },
    cityReviewer: { roles: REVIEW_ROLES, refusal: 'apiError.city.notReviewer' },
};

/** A city access the table does not name wants the owner: fail closed. */
function neededFor(access: CallableAccess): { readonly roles: readonly CityRole[]; readonly refusal: ApiErrorCode } {
    return CITY_ACCESS_ROLES[access] ?? { roles: ['owner'], refusal: 'apiError.city.notOwner' };
}

function requireRoleIn(cityId: string, role: CityRole | null, access: CallableAccess): void {
    if (role === null) {
        throw new ApiError('apiError.city.notMember', { cityId });
    }
    const needed = neededFor(access);
    if (!needed.roles.includes(role)) {
        throw new ApiError(needed.refusal, { cityId });
    }
}
