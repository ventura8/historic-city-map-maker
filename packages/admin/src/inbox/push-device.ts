/**
 * This browser's push registration as `localStorage` keeps it (`docs/research/M4-interfaces.md` §5.4): the device id
 * `notify.registerDevice` gave it and the admin it was registered for, as JSON under `PUSH_DEVICE_KEY`. Another admin
 * signed in on the same browser sees push off (the record is not theirs), and signing out unregisters the record's admin
 * from this browser (best effort) and forgets the record, so a shared computer stops showing the last admin's
 * notifications. A leaf module: the inbox's chunk and the shell's sign-out share it.
 */
import type { KeyValueStore } from '../app/ports.js';
import type { CallablesPort } from '../firebase/ports.js';

/** `localStorage`: `{uid, deviceId}` of this browser's registration. */
export const PUSH_DEVICE_KEY = 'hcm:admin:pushDevice';

export interface PushDeviceRecord {
    readonly uid: string;
    readonly deviceId: string;
}

function isRecord(value: unknown): value is PushDeviceRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const { uid, deviceId } = value as Readonly<Record<string, unknown>>;
    return typeof uid === 'string' && typeof deviceId === 'string';
}

/** The record this browser keeps; null without one, or for anything else under the key (an older version's bare id). */
export function storedPushDevice(local: KeyValueStore): PushDeviceRecord | null {
    const raw = local.get(PUSH_DEVICE_KEY);
    if (raw === null) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** The device id this browser registered for `uid`; null without one, or when the record is another admin's. */
export function pushDeviceOf(local: KeyValueStore, uid: string | null): string | null {
    const stored = storedPushDevice(local);
    return stored !== null && stored.uid === uid ? stored.deviceId : null;
}

export function rememberPushDevice(local: KeyValueStore, uid: string, deviceId: string): void {
    local.set(PUSH_DEVICE_KEY, JSON.stringify({ uid, deviceId }));
}

export function forgetPushDevice(local: KeyValueStore): void {
    local.remove(PUSH_DEVICE_KEY);
}

export interface SignOutPushDeps {
    readonly local: KeyValueStore;
    readonly callables: CallablesPort;
    /** The admin signing out (null: nobody is signed in). */
    readonly uid: string | null;
}

/**
 * Sign-out: this browser stops getting `uid`'s notifications. Unregistering is best effort (offline, it fails): the record
 * goes either way, since nobody can turn push off here once signed out. Another admin's record is left as it is.
 */
export async function unregisterOnSignOut(deps: SignOutPushDeps): Promise<void> {
    const deviceId = pushDeviceOf(deps.local, deps.uid);
    if (deviceId === null) {
        return;
    }
    await deps.callables.call('notify.unregisterDevice', { deviceId }).catch(() => undefined);
    forgetPushDevice(deps.local);
}
