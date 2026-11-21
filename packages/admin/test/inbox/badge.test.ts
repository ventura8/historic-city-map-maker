/**
 * The Notifications item's badge (`packages/admin/src/inbox/badge.ts`; `docs/research/M4-interfaces.md` §5.5): the
 * signed-in admin's unread count while the server answers, null otherwise; a refused listener asks who this is again.
 */
import { FIRESTORE_PATHS, INBOX_BADGE_MAX } from '@hcm/shared';
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it } from 'vitest';

import { InboxBadge } from '../../src/inbox/badge.js';
import type { ShellState } from '../../src/state/state.js';
import { shellStateAccess } from '../app/fakes.js';
import { asContentStore, at } from '../content/world.js';

const ADMIN = { uid: 'admin-uid', email: 'admin@e2e.test', displayName: 'Ana' };

function unread(store: FakeContentStore, uid: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
        store.put(FIRESTORE_PATHS.inboxItem(uid, `job.failed~c~j${String(index)}~0`), {
            kind: 'job.failed',
            severity: 'error',
            params: {},
            link: '#/jobs',
            createdAt: at('2026-10-24T08:00:00.000Z'),
            read: index % 3 === 0,
            updatedBy: 'system:notify',
            updatedAt: at('2026-10-24T08:00:00.000Z'),
        });
    }
}

function world() {
    const store = new FakeContentStore();
    const shell = shellStateAccess();
    const denied = { count: 0 };
    const badge = new InboxBadge({
        store: asContentStore(store),
        shell,
        denied: () => {
            denied.count += 1;
        },
    });
    const signIn = (patch: Partial<ShellState> = {}): void => {
        shell.update({ auth: 'admin', mode: 'normal', user: ADMIN, ...patch });
        badge.stateChanged(shell.get());
    };
    return { store, shell, denied, badge, signIn };
}

describe('the inbox badge', () => {
    it('happyPath_theSignedInAdminsUnreadItemsAreCountedLive', () => {
        const { store, shell, signIn, badge } = world();
        unread(store, ADMIN.uid, 6);
        unread(store, 'someone-else', 9);

        signIn();
        expect(shell.get().unread).toBe(4);

        store.drop(FIRESTORE_PATHS.inboxItem(ADMIN.uid, 'job.failed~c~j1~0'));
        expect(shell.get().unread).toBe(3);
        badge.stateChanged(shell.get());
        expect(store.listeners()).toBe(1);

        shell.update({ auth: 'signedOut', user: null });
        badge.stateChanged(shell.get());
        expect([shell.get().unread, store.listeners()]).toEqual([null, 0]);
    });

    it('happyPath_theCountStopsJustAboveTheBadgesMaximum', () => {
        const { store, shell, signIn } = world();
        unread(store, ADMIN.uid, (INBOX_BADGE_MAX + 10) * 2);

        signIn();

        expect(shell.get().unread).toBe(INBOX_BADGE_MAX + 1);
    });

    it('badPath_startUpModeAndARefusedListenerShowNoCount', () => {
        const { store, shell, signIn, denied } = world();
        signIn({ mode: 'bootstrap' });
        expect(store.listeners()).toBe(0);

        signIn();
        store.fail(FIRESTORE_PATHS.inbox(ADMIN.uid), { kind: 'denied', code: 'permission-denied' });
        store.fail(FIRESTORE_PATHS.inbox(ADMIN.uid), { kind: 'unavailable', code: 'unavailable' });

        expect([denied.count, shell.get().unread]).toEqual([1, 0]);
    });

    it('badPath_withoutTheEditorsThereIsNoBadge', () => {
        const shell = shellStateAccess();
        const badge = new InboxBadge({ store: null, shell, denied: () => undefined });
        shell.update({ auth: 'admin', mode: 'normal', user: ADMIN });

        badge.stateChanged(shell.get());
        badge.stop();

        expect(shell.get().unread).toBeNull();
    });
});
