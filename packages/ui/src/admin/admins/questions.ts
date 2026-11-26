/**
 * The questions the admins page asks before an irreversible step (M2c §9.1; M5 `docs/research/M5-interfaces.md` §1.7):
 * removing an admin, cancelling an invitation, or changing an admin's role in the city.
 */
import type { CityRole, UiLocale } from '@hcm/shared';

import { contentText, shellText } from '../shell/text.js';
import type { RevokeInputPort } from './admins-port.js';
import { roleText } from './roles.js';

/** A removal, a cancellation or (M5) a role change being asked about. */
export interface Pending {
    readonly request: RevokeInputPort | { readonly kind: 'role'; readonly uid: string; readonly role: CityRole };
    readonly name: string;
}

export interface Question {
    readonly headline: string;
    readonly body: string;
    readonly confirm: string;
    readonly cancel: string;
    readonly destructive: boolean;
}

/** What the question before a role change says (M5). */
function roleQuestion(locale: UiLocale, name: string, role: CityRole, city: string): Question {
    return {
        headline: shellText(locale, 'adminShell.admins.roleConfirm', { name, role: roleText(locale, role).toLowerCase(), city }),
        body: shellText(locale, 'adminShell.admins.roleOf', { name, city }),
        confirm: shellText(locale, 'adminShell.admins.roleConfirmAction'),
        cancel: contentText(locale, 'adminContent.common.cancel'),
        destructive: false,
    };
}

/** What the question before a removal, a cancellation or a role change says. */
export function questionOf(locale: UiLocale, pending: Pending | null, city: string): Question {
    if (pending?.request.kind === 'role') {
        return roleQuestion(locale, pending.name, pending.request.role, city);
    }
    if (pending?.request.kind === 'admin') {
        return {
            headline: contentText(locale, 'adminContent.admins.revokeConfirm', { name: pending.name }),
            body: contentText(locale, 'adminContent.admins.revokeBody'),
            confirm: contentText(locale, 'adminContent.admins.remove'),
            cancel: contentText(locale, 'adminContent.admins.keep'),
            destructive: true,
        };
    }
    return {
        headline: contentText(locale, 'adminContent.admins.cancelConfirm'),
        body: contentText(locale, 'adminContent.admins.cancelBody'),
        confirm: contentText(locale, 'adminContent.admins.cancelInvite'),
        cancel: contentText(locale, 'adminContent.admins.keepInvite'),
        destructive: true,
    };
}
