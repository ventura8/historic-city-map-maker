/**
 * `firebase/messaging`, in its own lazily imported module (`loadMessagingSdk` in `messaging.ts`): the build emits it as a
 * separate chunk, fetched only when an admin turns notifications on for a browser (`docs/research/M4-interfaces.md` §5.4).
 * The browser registers an FCM registration token (`getToken`, `deleteToken`; finding 50 of 2026-11-01: FCM refused the
 * installation id `register` gave). firebase 13 marks both deprecated: `eslint.config.js` allows these two here only
 * (DECISIONS-for-review.md §81d, the user's approval of 2026-11-01).
 */
import { deleteToken, getMessaging, getToken } from 'firebase/messaging';

export const messagingSdk = { getMessaging, getToken, deleteToken };
