/**
 * The `memberships` step of `ops.tick` (M5, `docs/research/M5-interfaces.md` §1.2; S-A51-HAPPY-MIGRATION,
 * S-A51-HAPPY-LEGACY-INVITE): every admin document from before M5 (no `cities`) gets every existing city, the project's
 * owner as their owner and every other admin as an editor, exactly as `admin.session` does for its caller
 * (`adminWithCities`), and every pending invitation from before M5 the cities of now (`migrateLegacyInvites`). Until
 * then the rules and the callables fail closed, so an admin who has not signed in since M5 is never locked out for
 * longer than one tick.
 */
import { adminWithCities, migrateLegacyInvites, projectAdmins } from '../api/memberships.js';
import type { Ports } from '../ports/index.js';

export type MembershipsDeps = Pick<Ports, 'documents' | 'clock'>;

/**
 * Migrates every admin document without `cities`, one at a time, then every pending invitation without them
 * (`migrateLegacyInvites`: the cities of now, never a later one); returns how many of both it found.
 */
export async function migrateMemberships(deps: MembershipsDeps): Promise<number> {
    const legacy = (await projectAdmins(deps.documents)).filter((entry) => entry.admin.cities === undefined);
    for (const { uid } of legacy) {
        await adminWithCities(deps, uid);
    }
    return legacy.length + (await migrateLegacyInvites(deps));
}
