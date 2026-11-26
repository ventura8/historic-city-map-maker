/** In-memory ports for handler tests: they record what the handler asked for. */
import { cityRoleOf, createLogger, type AdminRole, type CityRoles, type Logger, isContributorOnly } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';

import type { AdminDirectory, AdminMembership } from '../../src/ports/admin-directory.js';

export const NOW = '2026-10-11T08:30:00.000Z';

interface FakeAdmins extends AdminDirectory {
    readonly lookups: string[];
}

/** What the fake's admins hold: by default the project's owner and the owner of every city (the M2 to M4 handler tests). */
export interface FakeStanding {
    readonly projectRole?: AdminRole;
    /** The cities and roles of every listed admin; absent, each owns every city. */
    readonly cities?: CityRoles;
}

/** The membership `standing` describes. */
export function fakeMembership(standing: FakeStanding = {}): AdminMembership {
    const { cities } = standing;
    return {
        projectRole: standing.projectRole ?? 'owner',
        contributorOnly: isContributorOnly(cities),
        roleIn: (cityId) => (cities === undefined ? 'owner' : cityRoleOf(cities, cityId)),
    };
}

/** admins/{uid} documents exist for `uids` only, each with `standing`. */
export function fakeAdmins(uids: readonly string[], standing: FakeStanding = {}): FakeAdmins {
    const lookups: string[] = [];
    const lookup = (uid: string): boolean => {
        lookups.push(uid);
        return uids.includes(uid);
    };
    return {
        lookups,
        isAdmin: (uid) => Promise.resolve(lookup(uid)),
        membership: (uid) => Promise.resolve(lookup(uid) ? fakeMembership(standing) : null),
    };
}

export function recordingLogger(): { readonly log: Logger; readonly recording: RecordingSink } {
    const recording = createRecordingSink();
    return { log: createLogger('functions', { sink: recording.sink, minLevel: 'debug' }), recording };
}
