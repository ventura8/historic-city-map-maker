/**
 * The inbox (`docs/research/M4-interfaces.md` §5.5; behaviours A46, A47): the signed-in admin's notifications
 * (`admins/{uid}/inbox`, written by `notify.onEvent`) newest first, 50 at a time; opening one marks it read (`read`, the
 * stamp's server time records when: the rules allow nothing else); **Mark all as read** reads every unread item, loaded or
 * not, and marks them in batches of at most `MAX_BATCH_WRITES`. The push settings of this account (`admins/{uid}/notify/settings`: the kinds pushed to its
 * devices, saved with the Firestore SDK) and push on this browser (`push.ts`). Nothing here renders a notification:
 * the page fills each message from the catalogue with its parameters as plain text.
 */
import {
    DEFAULT_PUSH_KINDS,
    FIRESTORE_PATHS,
    inboxItemDocSchema,
    notifySettingsDocSchema,
    type InboxItemDoc,
    type NotificationKind,
    type NotificationSeverity,
    type NotifySettingsDoc,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, type DocState } from '../content/doc.js';
import { LOADING_LIST, LiveList, isoOf, type ListState, type LoadStatus } from '../content/list.js';
import { readOnce } from '../content/read-once.js';
import { MAX_BATCH_WRITES, type ContentServices, type Stored, type WriteOutcome } from '../content/services.js';
import { Store } from '../state/store.js';
import { PushSession, type PushState } from './push.js';

/** One notification as the page lists it. */
interface InboxRow {
    readonly id: string;
    readonly kind: NotificationKind;
    readonly severity: NotificationSeverity;
    readonly params: Readonly<Record<string, string>>;
    readonly link: string;
    readonly createdAt: string;
    readonly read: boolean;
}

export interface InboxSettings {
    readonly status: LoadStatus;
    readonly push: boolean;
    /** The kinds pushed; `DEFAULT_PUSH_KINDS` until the admin chose. */
    readonly kinds: readonly NotificationKind[];
    readonly saving: boolean;
}

export interface InboxState {
    readonly list: ListState<InboxRow>;
    readonly settings: InboxSettings;
    readonly push: PushState;
    readonly marking: boolean;
}

export interface InboxIntents {
    more(): void;
    retry(): void;
    markRead(id: string): void;
    markAllRead(): Promise<void>;
    setKind(kind: NotificationKind, on: boolean): Promise<void>;
    turnOnPush(): Promise<void>;
    turnOffPush(): Promise<void>;
    sendTest(): Promise<void>;
}

/** Items per page. */
export const INBOX_PAGE_SIZE = 50;

const LOADING_SETTINGS: InboxSettings = { status: 'loading', push: false, kinds: DEFAULT_PUSH_KINDS, saving: false };

function rowOf(doc: Stored<InboxItemDoc>): InboxRow {
    const { kind, severity, params, link, createdAt, read } = doc.data;
    return { id: doc.id, kind, severity, params, link, createdAt: isoOf(createdAt), read };
}

/** The settings as the page shows them: the stored ones, or push off with the default kinds. */
export function settingsOf(state: DocState<NotifySettingsDoc>): InboxSettings {
    if (state.status !== 'ready') {
        return { ...LOADING_SETTINGS, status: state.status };
    }
    return state.doc === null ? { ...LOADING_SETTINGS, status: 'ready' } : storedSettings(state.doc.data);
}

function storedSettings(stored: NotifySettingsDoc): InboxSettings {
    return { status: 'ready', push: stored.push, kinds: stored.pushKinds, saving: false };
}

/** The kinds after one switch. */
export function kindsWith(kinds: readonly NotificationKind[], kind: NotificationKind, on: boolean): NotificationKind[] {
    const others = kinds.filter((candidate) => candidate !== kind);
    return on ? [...others, kind] : others;
}

class InboxStore implements AreaStore<InboxState, InboxIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<InboxState>;
    readonly #list: LiveList<InboxItemDoc, InboxRow>;
    readonly #settings: LiveDoc<NotifySettingsDoc>;
    readonly #push: PushSession;
    readonly intents: InboxIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#push = new PushSession({
            ...{ registrar: services.push ?? null, callables: services.callables, local: services.local, locale: services.locale },
            uid: () => this.#uid(),
            notify: services.notify,
            log: services.log,
            changed: (push) => {
                this.#cell.update({ push });
            },
        });
        this.#cell = new Store<InboxState>(
            { list: LOADING_LIST, settings: LOADING_SETTINGS, push: this.#push.state, marking: false },
            services.log,
        );
        const { store, clock, denied } = services;
        this.#list = new LiveList({
            ...{ store, clock, denied, schema: inboxItemDocSchema, map: rowOf, pageSize: INBOX_PAGE_SIZE },
            collection: FIRESTORE_PATHS.inbox(this.#uid()),
            changed: (list) => {
                this.#cell.update({ list });
            },
        });
        this.#settings = new LiveDoc({
            ...{ store, clock, denied, schema: notifySettingsDocSchema },
            changed: (settings) => {
                this.#cell.update({ settings: settingsOf(settings) });
            },
        });
        this.intents = this.#makeIntents();
    }

    get state(): InboxState {
        return this.#cell.state;
    }

    subscribe(listener: (state: InboxState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        if (!this.#list.active) {
            this.#list.showIn(FIRESTORE_PATHS.inbox(this.#uid()), { orderBy: [['createdAt', 'desc']] });
            this.#settings.show(FIRESTORE_PATHS.notifySettings(this.#uid()));
        }
    }

    close(): void {
        this.#list.stop();
        this.#settings.stop();
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
    }

    /** The signed-in admin (the page exists only while one is). */
    #uid(): string {
        return this.#services.user()?.uid ?? 'nobody';
    }

    #makeIntents(): InboxIntents {
        return {
            more: () => {
                this.#list.more();
            },
            retry: () => {
                this.#list.retry();
            },
            markRead: (id) => {
                void this.#markRead(id);
            },
            markAllRead: () => this.#markAllRead(),
            setKind: (kind, on) => this.#setKind(kind, on),
            turnOnPush: () => this.#push.turnOn(),
            turnOffPush: () => this.#push.turnOff(),
            sendTest: () => this.#push.sendTest(),
        };
    }

    async #markRead(id: string): Promise<void> {
        const row = this.#cell.state.list.items.find((item) => item.id === id);
        if (row !== undefined && !row.read) {
            this.#reported(await this.#services.store.update(FIRESTORE_PATHS.inboxItem(this.#uid(), id), { read: true }, null));
        }
    }

    async #markAllRead(): Promise<void> {
        this.#cell.update({ marking: true });
        const outcome = await this.#markUnread();
        this.#cell.update({ marking: false });
        this.#reported(outcome);
    }

    /** One batch of the unread items, whatever pages the list loaded, then the next while the read filled its limit. */
    async #markUnread(): Promise<WriteOutcome> {
        const query = { where: [['read', '==', false]], limit: MAX_BATCH_WRITES } as const;
        const { page, failure } = await readOnce(this.#services, FIRESTORE_PATHS.inbox(this.#uid()), inboxItemDocSchema, query);
        if (page === null) {
            return { ok: false, reason: failure };
        }
        if (page.docs.length === 0) {
            return { ok: true };
        }
        const outcome = await this.#services.store.batch(
            page.docs.map((doc) => ({ kind: 'update', path: doc.path, fields: { read: true } })),
        );
        return outcome.ok && page.hasMore ? this.#markUnread() : outcome;
    }

    async #setKind(kind: NotificationKind, on: boolean): Promise<void> {
        const settings = this.#cell.state.settings;
        const pushKinds = kindsWith(settings.kinds, kind, on);
        this.#cell.update({ settings: { ...settings, kinds: pushKinds, saving: true } });
        const path = FIRESTORE_PATHS.notifySettings(this.#uid());
        const exists = this.#settings.state.doc !== null;
        const outcome = exists
            ? await this.#services.store.update(path, { pushKinds }, null)
            : await this.#services.store.create(path, { push: settings.push, pushKinds });
        this.#cell.update({ settings: { ...this.#cell.state.settings, saving: false } });
        this.#reported(outcome, 'adminContent.notify.settings.saved');
    }

    /** A saved change says so when asked; a refused or failed write is reported (`#failed`). */
    #reported(outcome: WriteOutcome, saved?: 'adminContent.notify.settings.saved'): void {
        if (!outcome.ok) {
            this.#failed(outcome.reason);
        } else if (saved !== undefined) {
            this.#services.notify({ key: saved });
        }
    }

    /**
     * A refused write (`denied`: the shell asks who this is again) or one made offline is said; an item the fan-out pruned
     * meanwhile (`gone`) needs no word.
     */
    #failed(reason: Exclude<WriteOutcome, { readonly ok: true }>['reason']): void {
        if (reason === 'denied') {
            this.#services.denied();
            this.#services.notify({ key: 'adminContent.common.denied' });
        } else if (reason === 'offline') {
            this.#services.notify({ key: 'adminContent.common.offline' });
        }
    }
}

export const INBOX_MODULE: AreaModule<InboxState, InboxIntents> = {
    area: 'inbox',
    create: (services) => new InboxStore(services),
};
