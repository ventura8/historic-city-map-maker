import type { CallableRequest } from '@hcm/shared';

import type { SetupStatusFields } from './records.js';

/**
 * What `setup.recordCloud` records for the in-app installer (`docs/research/M6-interfaces.md` §1.7): each install
 * target's last known state (`setup/status.install`: the server, the imagery pipeline, the public site), so Home can say
 * an update is ready or an install stopped without a Google token. A report names the targets it saw; the others keep
 * their record. Nothing else travels: no token, no address, no log line (`setupInstallSchema` refuses them).
 */
type Request = CallableRequest<'setup.recordCloud'>;

type InstallReport = NonNullable<Request['install']>;
type InstallRecord = NonNullable<InstallReport[keyof InstallReport]>;

/** True when `stored` was checked after `reported`: two reports of one tab may land out of order. */
function storedIsNewer(stored: unknown, reported: InstallRecord): boolean {
    const checkedAt = typeof stored === 'object' && stored !== null ? (stored as { checkedAt?: unknown }).checkedAt : undefined;
    return typeof checkedAt === 'string' && Date.parse(checkedAt) > Date.parse(reported.checkedAt);
}

/** `current` with the reported install targets replacing theirs, unless what is stored was checked later. */
export function applyInstallReport(current: SetupStatusFields, request: Request): SetupStatusFields {
    if (request.install === undefined) {
        return current;
    }
    const stored: Readonly<Record<string, unknown>> = current.install ?? {};
    const newer = Object.entries(request.install).filter(
        (entry): entry is [string, InstallRecord] => entry[1] !== undefined && !storedIsNewer(stored[entry[0]], entry[1]),
    );
    return { ...current, install: { ...stored, ...Object.fromEntries(newer) } };
}
