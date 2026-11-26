/**
 * The admin's auth states (`docs/research/M2b-interfaces.md` §1.3), one value at a time. `auth/controller.ts` moves
 * between them; the shell (`packages/ui/src/admin/shell/`) shows one screen per state.
 */
export const ADMIN_AUTH_STATES = [
    /** The page loads: the probe and the first Auth answer are pending. */
    'starting',
    /** `/__/firebase/init.json` is unreadable or fails its schema. */
    'configMissing',
    /** No Firebase user; sign-out; the session was revoked. */
    'signedOut',
    /** The sign-in click opened Google's popup. */
    'signingIn',
    /** A Firebase user exists; the server or Google decides what they may do. */
    'probing',
    /** The server did not answer and the account owns the project: Setup in start-up mode. */
    'bootstrap',
    /** The server did not answer, the account does not own the project and Cloud Functions was never enabled. */
    'notOwner',
    /** The server did not answer and the map was set up (or the check is unavailable): Try again. */
    'backendDown',
    /** The map has no owner yet and no live Google token proves ownership: one click. */
    'claimPending',
    /** `admin.claim` is running. */
    'claiming',
    /** An invitation for this account waits. */
    'joinPending',
    /** The map has an owner and no invitation waits. */
    'notAdmin',
    /** The shell in normal mode. */
    'admin',
    /** M13: a signed-in account of no role here, on the Contribute page, which needs no more (`docs/research/M13-roles.md` §3). */
    'visitor',
    /** M13 §3: the Contribute page of a map nobody set up yet (no owner, or a start-up deploy's): not open to contributions. */
    'contributeClosed',
] as const;

export type AdminAuthState = (typeof ADMIN_AUTH_STATES)[number];

/** Bootstrap: no server yet, Google REST only (§3.2). Normal: the server answers. Null until the probe has answered. */
export type AdminMode = 'bootstrap' | 'normal';

/** The states whose screen is the shell itself (navigation and pages). */
export function showsShell(state: AdminAuthState): boolean {
    return state === 'admin' || state === 'bootstrap' || state === 'visitor';
}
