/**
 * When Setup is done (`docs/research/M6-interfaces.md` §4.1, setup-ux; findings 16 and 24 of the live test of
 * 2026-10-25): billing, the project's preparation and Mapbox are `ok`; USGS is `ok`, postponed (**Do it later**), or
 * waiting for USGS's M2M approval with its token saved (`apiError.usgs.accessPending`, which takes days); and, once
 * Setup records the installer's targets (`setup/status.install`, installer), the server and the public site are
 * installed. Optional steps and the optional server checks never hold it back. One rule for the Setup page's header,
 * the dashboard-first rule (`DECISIONS-for-review.md` §34i) and Home's reminders; it reads only states, so a stored
 * record, a callable's view and the Setup Assistant's own state all fit.
 */
import type { ServiceState } from '../schemas/firestore-ops.js';

/** USGS's part in "done": verified, postponed, or waiting for the approval of a saved token; else still to do. */
export type UsgsReadiness = 'ok' | 'postponed' | 'approvalPending' | 'toDo';

/** How an area of `setup/status` reads here (a stored timestamp or an ISO string for `postponedAt` alike). */
interface AreaHealth {
    readonly state: ServiceState;
    readonly detail?: string | undefined;
    readonly postponedAt?: unknown;
}

/** One installer target as `setup/status.install` records it (`installRecordSchema`, installer). */
interface InstallHealth {
    readonly state: string;
    /** The release installed, when it names one. */
    readonly release?: string | undefined;
}

/** What `setupDone` reads: a `setup/status` document, a `setup.status` view, or the Setup Assistant's own summary. */
export interface SetupDoneInput {
    readonly billing?: AreaHealth | undefined;
    readonly provision?: AreaHealth | undefined;
    readonly mapbox?: AreaHealth | undefined;
    readonly usgs?: AreaHealth | undefined;
    readonly install?: { readonly server?: InstallHealth | undefined; readonly site?: InstallHealth | undefined } | undefined;
}

/** The reason a pending USGS card shows while USGS has not approved M2M downloads (CR-M2-16). */
export const USGS_ACCESS_PENDING = 'apiError.usgs.accessPending';

/** The areas that must be `ok`, whatever USGS is. */
const DONE_AREAS = ['billing', 'provision', 'mapbox'] as const;

/** The installer's states in which the target is installed (an update may be available, or the target is newer). */
const INSTALLED: ReadonlySet<string> = new Set(['installed', 'updateAvailable', 'newerInstalled']);

/** USGS's part in "done", tried in order: verified, postponed, waiting for the approval of a saved token. */
const READINESS: readonly (readonly [UsgsReadiness, (usgs: AreaHealth) => boolean])[] = [
    ['ok', (usgs) => usgs.state === 'ok'],
    ['postponed', (usgs) => usgs.postponedAt !== undefined],
    ['approvalPending', (usgs) => usgs.state === 'pending' && usgs.detail === USGS_ACCESS_PENDING],
];

/** USGS's part in "done" (a missing area is still to do). */
export function usgsReadiness(usgs: AreaHealth | undefined): UsgsReadiness {
    if (usgs === undefined) {
        return 'toDo';
    }
    return READINESS.find(([, test]) => test(usgs))?.[0] ?? 'toDo';
}

/**
 * A target is installed in an installed state, or whenever a release of it is recorded, whatever its build does now: an
 * update under way (15 to 85 minutes) or one that stopped leaves the installed release serving, so Setup stays done
 * (finding 5 of the M6 review).
 */
function targetInstalled(target: InstallHealth | undefined): boolean {
    return target !== undefined && (INSTALLED.has(target.state) || target.release !== undefined);
}

/**
 * The installer's targets: nothing recorded is a map installed before M6 (its server answers, so it is there); once
 * Setup records them, the server and the site must both be installed.
 */
function installed(install: SetupDoneInput['install']): boolean {
    if (install === undefined) {
        return true;
    }
    return [install.server, install.site].every(targetInstalled);
}

/** Setup is done: what the header says, and when an empty address opens Home. */
export function setupDone(status: SetupDoneInput): boolean {
    return DONE_AREAS.every((area) => status[area]?.state === 'ok') && usgsReadiness(status.usgs) !== 'toDo' && installed(status.install);
}
