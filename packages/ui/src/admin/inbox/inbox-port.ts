/**
 * The inbox as its page reads it (`docs/research/M4-interfaces.md` §5.5), mirroring `packages/admin/src/inbox/inbox.ts`
 * (checked at compile time by `packages/admin/test/app/admin-port.test.ts`): the admin's notifications newest first, the
 * push settings of this account and the push state of this browser.
 */
import type { NotificationKind, NotificationSeverity } from '@hcm/shared';

import type { ListStatePort, LoadStatusPort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';

/** One notification of the admin's inbox. */
export interface InboxRowPort {
    readonly id: string;
    readonly kind: NotificationKind;
    readonly severity: NotificationSeverity;
    /** The message's parameters, plain text (the English ones as `<name>En`). */
    readonly params: Readonly<Record<string, string>>;
    /** The admin page it opens (`#/imagery/version/<id>`). */
    readonly link: string;
    /** ISO time. */
    readonly createdAt: string;
    readonly read: boolean;
}

/** What this account pushes (`admins/{uid}/notify/settings`). */
export interface InboxSettingsPort {
    readonly status: LoadStatusPort;
    /** Push is on for this account (each browser still asks its own permission). */
    readonly push: boolean;
    readonly kinds: readonly NotificationKind[];
    readonly saving: boolean;
}

/**
 * This browser: no push here (`unsupported`), not asked or turned off (`off`), the browser's prompt or the registration
 * under way (`working`), registered (`on`), refused by the browser (`denied`), or the registration failed (`failed`).
 */
type PushDevicePort = 'unsupported' | 'off' | 'working' | 'on' | 'denied' | 'failed';

interface InboxPushPort {
    readonly device: PushDevicePort;
    /** Why the last attempt failed (`failed`), as a message. */
    readonly failure: AdminNoticeInputPort | null;
    /** The failure's reason line with its code (finding 46 of 2026-11-01: the SDK's, or FCM's answer), or null. */
    readonly reason: AdminNoticeInputPort | null;
    /** A test notification is being sent. */
    readonly testing: boolean;
}

export interface InboxViewState {
    readonly list: ListStatePort<InboxRowPort>;
    readonly settings: InboxSettingsPort;
    readonly push: InboxPushPort;
    /** Mark all as read is being written. */
    readonly marking: boolean;
}

export interface InboxIntentsPort {
    more(): void;
    retry(): void;
    /** The admin opened an item (its link opens the page it is about): marked read. */
    markRead(id: string): void;
    markAllRead(): Promise<void>;
    /** One kind pushed to this account's devices, or not. */
    setKind(kind: NotificationKind, on: boolean): Promise<void>;
    /** The browser's own prompt, then this browser's registration. */
    turnOnPush(): Promise<void>;
    turnOffPush(): Promise<void>;
    sendTest(): Promise<void>;
}
