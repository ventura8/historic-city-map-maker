/**
 * The admin's messages as its elements receive them (`docs/research/M2b-interfaces.md` §1.6): a key of any admin
 * catalogue with its parameters, and a call's outcome. Apart from `admin-port.ts` (which re-exports them) so that an
 * area's port can use them without importing the app's port, which imports every area's (dependency-cruiser
 * `no-circular`).
 */
import type { AdminContentKey, AdminSetupKey, AdminShellKey, ApiErrorCode } from '@hcm/shared';

/** A message key of any admin catalogue: the shell's, the Setup Assistant's, the editors' or the API's error codes. */
export type AdminNoticeKey = AdminShellKey | AdminSetupKey | AdminContentKey | ApiErrorCode;

export interface AdminNoticeInputPort {
    readonly key: AdminNoticeKey;
    readonly params?: Readonly<Record<string, string>>;
    /** The snackbar's action (an editor's Undo, `docs/research/M2c-interfaces.md` §9.5; M6: the import's Open). */
    readonly action?: { readonly key: AdminContentKey | AdminSetupKey; run(): void };
}

/** A call's result for a screen: the value, or the message to show. */
export type AdminOutcomePort<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AdminNoticeInputPort };
