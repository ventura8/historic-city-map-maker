/**
 * The confirmation questions of the admins page (M2c §9.1; M5 `docs/research/M5-interfaces.md` §1.7): changing a role,
 * removing an admin, cancelling an invitation, and the fallback when nothing is pending.
 */
import { describe, expect, it } from 'vitest';

import { questionOf } from '../../../src/admin/admins/questions.js';

describe('the admins page questions', () => {
    it('happyPath_roleChangeAndAdminRemovalAndInviteCancellation', () => {
        expect(questionOf('en', { request: { kind: 'role', uid: 'u1', role: 'owner' }, name: 'Ana' }, 'Bucharest')).toEqual({
            headline: 'Make Ana owner of Bucharest?',
            body: 'Role of Ana in Bucharest',
            confirm: 'Change the role',
            cancel: 'Cancel',
            destructive: false,
        });

        expect(questionOf('ro', { request: { kind: 'admin', uid: 'u1' }, name: 'Ana' }, 'București')).toEqual({
            headline: 'Retragi accesul pentru Ana?',
            body: 'Nu se mai poate conecta la administrare. O poți invita din nou oricând.',
            confirm: 'Retrage accesul',
            cancel: 'Păstrează accesul',
            destructive: true,
        });

        expect(questionOf('en', { request: { kind: 'invite', inviteId: 'i1' }, name: 'ana@example.com' }, 'Bucharest')).toEqual({
            headline: 'Cancel this invitation?',
            body: 'The link stops working. You can invite the same address again.',
            confirm: 'Cancel invitation',
            cancel: 'Keep the invitation',
            destructive: true,
        });
    });

    it('badPath_noPendingActionFallsBackToCancelInvitationQuestion', () => {
        expect(questionOf('ro', null, 'București')).toEqual({
            headline: 'Anulezi această invitație?',
            body: 'Linkul nu mai funcționează. Poți invita aceeași adresă din nou.',
            confirm: 'Anulează invitația',
            cancel: 'Păstrează invitația',
            destructive: true,
        });
    });
});
