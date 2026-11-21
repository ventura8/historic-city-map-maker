/**
 * What a notification says on a device (`docs/research/M4-interfaces.md` §5.3, §5.4): the admin catalogue's message of
 * its kind (`adminContent.notify.event.<kind>`) filled with the event's parameters as plain text, in each device's
 * language, and the admin page it opens. Pushing to the devices of one admin, and forgetting the devices FCM no longer
 * knows, is shared by the fan-out and `notify.sendTest`.
 */
import {
    FIRESTORE_PATHS,
    paramsIn,
    pushDeviceDocSchema,
    translateAdminContent,
    type Locale,
    type NotificationKind,
    type PushDeviceDoc,
} from '@hcm/shared';

import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import type { PushTarget } from '../ports/push-sender.js';

export const NOTIFY_WRITER = 'notify';

export type PushDeps = Pick<Ports, 'documents' | 'push' | 'config' | 'log'>;

type PushMessage = Parameters<Ports['push']['send']>[1];

/** The message of an event of `kind`, in `locale` (an English reader gets the English parameters, `paramsIn`). */
export function notificationText(locale: Locale, kind: NotificationKind, params: Readonly<Record<string, string>>): string {
    return translateAdminContent(locale, `adminContent.notify.event.${kind}`, paramsIn(locale, params));
}

/** An admin route (`#/jobs`) as an address on the admin's own origin, which a notification opens. */
export function adminAddress(deps: Pick<Ports, 'config'>, link: string): string {
    return `${deps.config.adminUrl}${link}`;
}

/** What one language's devices are sent. */
export interface PushContent {
    readonly body: (locale: Locale) => string;
    readonly link: string;
    readonly tag: string;
}

function messageIn(locale: Locale, content: PushContent): PushMessage {
    return {
        title: translateAdminContent(locale, 'adminContent.notify.title'),
        body: content.body(locale),
        link: content.link,
        tag: content.tag,
    };
}

/** The admin's devices. */
export async function devicesOf(deps: Pick<Ports, 'documents'>, uid: string): Promise<readonly StoredDocument<PushDeviceDoc>[]> {
    return (await deps.documents.query(FIRESTORE_PATHS.pushDevices(uid), pushDeviceDocSchema)).documents;
}

export interface PushResult {
    readonly sent: number;
    readonly removed: number;
}

/**
 * Sends `content` to every device of `uid`, each in its own language, and deletes the devices whose token FCM no
 * longer knows. A failure of FCM itself is the caller's to handle.
 */
export async function pushToDevices(
    deps: PushDeps,
    uid: string,
    devices: readonly StoredDocument<PushDeviceDoc>[],
    content: PushContent,
): Promise<PushResult> {
    let sent = 0;
    const gone: string[] = [];
    for (const locale of new Set(devices.map((device) => device.data.lang))) {
        // A device recorded before finding 50 (no kind) is an installation id.
        const targets = devices
            .filter((device) => device.data.lang === locale)
            .map((device): PushTarget => ({ kind: device.data.kind ?? 'fid', value: device.data.token }));
        const outcome = await deps.push.send(targets, messageIn(locale, content));
        sent += outcome.sent;
        gone.push(...outcome.unregistered);
    }
    const stale = devices.filter((device) => gone.includes(device.data.token));
    for (const device of stale) {
        await deps.documents.delete(FIRESTORE_PATHS.pushDevice(uid, device.id));
    }
    if (stale.length > 0) {
        deps.log.info('push devices forgotten', { uid, count: stale.length });
    }
    return { sent, removed: stale.length };
}
