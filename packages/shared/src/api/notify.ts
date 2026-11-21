/**
 * Notifications on an admin's devices (M4; `docs/research/M4-interfaces.md` §5.4): a browser that granted the permission
 * registers its FCM token (checked with FCM before it is stored), and an admin can send a test to their own devices. The
 * inbox itself needs no callable: the admin reads their items and marks them read with the Firestore SDK (the rules).
 * The registry rows (owner `fn-assist-notify`) join with their implementation.
 */
import { z } from 'zod';

import { LOCALES } from '../i18n/index.js';
import { PUSH_TARGET_KINDS } from '../schemas/notifications.js';
import { PUSH_DEVICE_ID_PATTERN } from '../schemas/paths.js';

const deviceIdSchema = z.string().regex(PUSH_DEVICE_ID_PATTERN);

/** `notify.registerDevice` (admin): this browser's FCM registration token and the language its notifications use. */
export const notifyRegisterDeviceRequestSchema = z.strictObject({
    token: z
        .string()
        .min(20)
        .max(4096)
        .regex(/^[A-Za-z0-9_:.-]+$/),
    /** What the token is (finding 50 of 2026-11-01): an FCM registration token unless the browser says otherwise. */
    kind: z.enum(PUSH_TARGET_KINDS).default('token'),
    lang: z.enum(LOCALES),
});
export const notifyRegisterDeviceResponseSchema = z.strictObject({ deviceId: deviceIdSchema });

/** `notify.unregisterDevice` (admin): push off for this browser (its permission stays the browser's). */
export const notifyUnregisterDeviceRequestSchema = z.strictObject({ deviceId: deviceIdSchema });
export const notifyUnregisterDeviceResponseSchema = z.strictObject({ removed: z.boolean() });

/** `notify.sendTest` (admin): one test notification to the caller's own devices; how many FCM accepted. */
export const notifySendTestRequestSchema = z.strictObject({});
export const notifySendTestResponseSchema = z.strictObject({ sent: z.number().int().min(0), removed: z.number().int().min(0) });

export type NotifyRegisterDeviceRequest = z.infer<typeof notifyRegisterDeviceRequestSchema>;
