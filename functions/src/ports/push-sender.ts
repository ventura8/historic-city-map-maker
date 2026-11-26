import type { PushTargetKind } from '@hcm/shared';

/**
 * Firebase Cloud Messaging HTTP v1 (M4, `docs/research/M4-interfaces.md` §5.4): web push to the browsers an admin allowed
 * (`admins/{uid}/pushDevices`), through firebase-admin's `getMessaging()` with the functions' service account (no server
 * key). A message carries the item's localized title and text and its admin link as data (`webpush.fcmOptions.link`);
 * nothing in it is HTML. Adapter `functions/src/adapters/fcm.ts` (assists-notify); failures are
 * `UpstreamError('fcm', …)`, except the per-token outcome below.
 */
interface PushMessage {
    readonly title: string;
    readonly body: string;
    /** An admin route (`ADMIN_LINK_PATTERN`) on the admin's own origin. */
    readonly link: string;
    /** Collapses repeats of one event on a device (the event id). */
    readonly tag: string;
}

/** One browser as FCM addresses it (finding 50 of 2026-11-01): `message.token` or `message.fid` set to `value`. */
export interface PushTarget {
    readonly kind: PushTargetKind;
    readonly value: string;
}

/** Per token: delivered to FCM, or refused because the token is gone (`messaging/registration-token-not-registered`). */
interface PushOutcome {
    readonly sent: number;
    /** The values of the targets FCM no longer knows: their device documents are deleted. */
    readonly unregistered: readonly string[];
}

/**
 * A dry run's verdict: accepted, or refused with FCM's code (`UNREGISTERED`, `INVALID_ARGUMENT`, …, or `HTTP_<status>` when
 * the answer names none), which the admin shows (finding 46 of `docs/research/manual-test-2026-10-25.md`).
 */
type PushCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PushSender {
    send(targets: readonly PushTarget[], message: PushMessage): Promise<PushOutcome>;
    /** A dry-run send (`validateOnly`): whether FCM accepts the target, before it is stored, and why not. */
    validate(target: PushTarget): Promise<PushCheck>;
}
