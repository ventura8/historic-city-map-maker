/**
 * The Notifications item's badge (`docs/research/M4-interfaces.md` §5.5; S-A46-HAPPY): while an admin is signed in with
 * the server (normal mode) the shell watches their unread notifications (`admins/{uid}/inbox` where `read == false`,
 * at most `INBOX_BADGE_MAX` + 1, so `99+` needs no more) and sets `unread`; signed out, or in start-up mode, it is null.
 * A `permission-denied` (the admin was removed) asks the server again who this is, as the city's theme does.
 */
import { FIRESTORE_PATHS, INBOX_BADGE_MAX, inboxItemDocSchema } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentStore } from '../content/services.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';

export interface InboxBadgeDeps {
    /** The editors' Firestore (`ContentDeps.store`); none without the editors (no badge). */
    readonly store: ContentStore | null;
    readonly shell: ShellStateAccess;
    readonly denied: () => void;
}

/** The admin whose inbox is watched: the signed-in one while the server answers (normal mode), else none. */
function watchedUid(state: Pick<ShellState, 'auth' | 'mode' | 'user'>): string | null {
    const serverAnswers = state.auth === 'admin' && state.mode === 'normal';
    return serverAnswers ? (state.user?.uid ?? null) : null;
}

export class InboxBadge {
    readonly #deps: InboxBadgeDeps;
    #watched: { readonly uid: string; readonly stop: Unsubscribe } | null = null;

    constructor(deps: InboxBadgeDeps) {
        this.#deps = deps;
    }

    /** Follows the signed-in admin: a new uid watches its own inbox, none stops. */
    stateChanged(state: ShellState): void {
        const uid = watchedUid(state);
        if (uid === (this.#watched?.uid ?? null)) {
            return;
        }
        this.stop();
        if (uid !== null) {
            this.#start(uid);
        }
    }

    stop(): void {
        this.#watched?.stop();
        this.#watched = null;
        if (this.#deps.shell.get().unread !== null) {
            this.#deps.shell.update({ unread: null });
        }
    }

    #start(uid: string): void {
        const store = this.#deps.store;
        if (store === null) {
            return;
        }
        const stop = store.watchQuery(
            FIRESTORE_PATHS.inbox(uid),
            inboxItemDocSchema,
            { where: [['read', '==', false]], limit: INBOX_BADGE_MAX + 1 },
            (page) => {
                this.#deps.shell.update({ unread: page.docs.length });
            },
            (failure) => {
                if (failure.kind === 'denied') {
                    this.#deps.denied();
                }
            },
        );
        this.#watched = { uid, stop };
    }
}
