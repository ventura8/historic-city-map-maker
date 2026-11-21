/**
 * Push on this browser (`docs/research/M4-interfaces.md` §5.4; S-A47-HAPPY, S-A47-BAD-PERMISSION-DENIED): off until the
 * admin turns **Notifications on this device** on; only then is the browser's own permission prompt shown. Refused, the
 * inbox keeps working and the page says so; granted, the browser's FCM token is registered with `notify.registerDevice`
 * (the server checks it with FCM first) and the device id is remembered in `localStorage` for this admin
 * (`push-device.ts`), so their next visit shows push as on and another admin's shows it off. Turning it off unregisters
 * this browser only; when the server cannot be reached, push stays on and the snackbar says why (nothing is forgotten that
 * the server still pushes to). The FCM SDK and the service worker are behind `PushRegistrar` (`../firebase/messaging.ts`;
 * the `e2e` build's stand-in hands out a fixed token, since no browser test reaches FCM).
 *
 * Finding 46 of 2026-11-01: a failure says why on a line of its own, with its code (`push-failure.ts`: the SDK's code, or
 * FCM's answer to the server's dry run), and the log keeps the code and the SDK's text without ids. When FCM refuses the
 * registration this browser handed out (`apiError.notify.deviceInvalid`, whatever the server's release), the registrar
 * forgets the SDK's record of it and the browser registers once more, with a new registration, before the page says so.
 */
import { contentLocale, pluralOf, type UiLocale, type Logger, type PushTargetKind } from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { KeyValueStore } from '../app/ports.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';
import { forgetPushDevice, pushDeviceOf, rememberPushDevice } from './push-device.js';
import { fcmRefusalOf, pushFailureOf, pushReason } from './push-failure.js';

export type PushPermission = 'default' | 'granted' | 'denied';

/** This browser's push: the Notifications API's permission and the FCM token of its service worker. */
export interface PushRegistrar {
    /** False without the Notifications, service worker or Push API (an old browser, an insecure page). */
    supported(): boolean;
    permission(): PushPermission;
    /** The browser's own prompt: called only from the admin's click. */
    requestPermission(): Promise<PushPermission>;
    /** What `token` hands out (finding 50 of 2026-11-01): an FCM registration token or an installation id. */
    readonly kind: PushTargetKind;
    /** This browser's FCM registration token (its service worker registered first); a failure is a `PushFailure`. */
    token(): Promise<string>;
    /** Forgets this browser's registration, so the next `token` makes a new one (FCM refused the last). Never throws. */
    reset(): Promise<void>;
}

type PushDevice = 'unsupported' | 'off' | 'working' | 'on' | 'denied' | 'failed';

export interface PushState {
    readonly device: PushDevice;
    readonly failure: NoticeInput | null;
    /** The failure's reason line with its code (finding 46), or null. */
    readonly reason: NoticeInput | null;
    readonly testing: boolean;
}

export interface PushDeps {
    readonly registrar: PushRegistrar | null;
    readonly callables: CallablesPort;
    readonly local: KeyValueStore;
    /** The signed-in admin: the browser's registration is theirs or not. */
    readonly uid: () => string;
    readonly locale: () => UiLocale;
    readonly notify: (notice: NoticeInput) => void;
    readonly changed: (state: PushState) => void;
    readonly log: Logger;
}

/** One registration: the device id the server stored, or why not (and whether FCM refused what the browser handed out). */
type Attempt =
    | { readonly ok: true; readonly deviceId: string }
    | { readonly ok: false; readonly failure: NoticeInput; readonly reason: NoticeInput | null; readonly refused: boolean };

/** What this browser shows before anything is clicked. */
function initialPush(registrar: PushRegistrar | null, local: KeyValueStore, uid: string): PushState {
    return { device: deviceOf(registrar, local, uid), failure: null, reason: null, testing: false };
}

function deviceOf(registrar: PushRegistrar | null, local: KeyValueStore, uid: string): PushDevice {
    if (registrar?.supported() !== true) {
        return 'unsupported';
    }
    const permission = registrar.permission();
    return permission === 'denied' ? 'denied' : registeredHere(permission, local, uid);
}

/** Granted, and registered from this browser for this admin before (their device id remembered). */
function registeredHere(permission: PushPermission, local: KeyValueStore, uid: string): PushDevice {
    return permission === 'granted' && pushDeviceOf(local, uid) !== null ? 'on' : 'off';
}

const NO_REGISTRAR = 'apiError.unavailable';

/** "The test notification went to 1 device" in the plural form `count` takes in the admin's language. */
function testSent(locale: UiLocale, count: number): NoticeInput {
    return { key: `adminContent.notify.push.testSent.${pluralOf(locale, count)}`, params: { count: String(count) } };
}

export class PushSession {
    readonly #deps: PushDeps;
    #state: PushState;

    constructor(deps: PushDeps) {
        this.#deps = deps;
        this.#state = initialPush(deps.registrar, deps.local, deps.uid());
    }

    get state(): PushState {
        return this.#state;
    }

    async turnOn(): Promise<void> {
        const registrar = this.#usable();
        if (registrar === null) {
            return;
        }
        this.#set({ device: 'working', failure: null, reason: null });
        const permission = await registrar.requestPermission();
        if (permission !== 'granted') {
            this.#set({ device: permission === 'denied' ? 'denied' : 'off' });
            return;
        }
        await this.#register(registrar);
    }

    /** Unregisters this browser; a call that fails leaves push on (the server would still push here) and says why. */
    async turnOff(): Promise<void> {
        const deviceId = pushDeviceOf(this.#deps.local, this.#deps.uid());
        this.#set({ device: 'working', failure: null });
        if (deviceId !== null) {
            const outcome = await outcomeOf(() => this.#deps.callables.call('notify.unregisterDevice', { deviceId }));
            if (!outcome.ok) {
                this.#set({ device: 'on' });
                this.#deps.notify(outcome.error);
                return;
            }
            forgetPushDevice(this.#deps.local);
        }
        this.#set({ device: 'off' });
    }

    async sendTest(): Promise<void> {
        this.#set({ testing: true });
        const outcome = await outcomeOf(() => this.#deps.callables.call('notify.sendTest', {}));
        this.#set({ testing: false });
        this.#deps.notify(outcome.ok ? testSent(this.#deps.locale(), outcome.value.sent) : outcome.error);
    }

    async #register(registrar: PushRegistrar): Promise<void> {
        const first = await this.#attempt(registrar);
        const outcome = !first.ok && first.refused ? await this.#renewed(registrar) : first;
        if (!outcome.ok) {
            this.#set({ device: 'failed', failure: outcome.failure, reason: outcome.reason });
            return;
        }
        rememberPushDevice(this.#deps.local, this.#deps.uid(), outcome.deviceId);
        this.#set({ device: 'on' });
    }

    /** FCM refused the registration the browser handed out: the registrar forgets it, and the browser registers once more. */
    async #renewed(registrar: PushRegistrar): Promise<Attempt> {
        this.#deps.log.info('push registration refused: registering this browser again');
        await registrar.reset().catch(() => undefined);
        return this.#attempt(registrar);
    }

    async #attempt(registrar: PushRegistrar): Promise<Attempt> {
        let token: string;
        try {
            token = await registrar.token();
        } catch (error) {
            return this.#registrarFailed(error);
        }
        const outcome = await outcomeOf(() =>
            this.#deps.callables.call('notify.registerDevice', { token, kind: registrar.kind, lang: contentLocale(this.#deps.locale()) }),
        );
        if (outcome.ok) {
            return { ok: true, deviceId: outcome.value.deviceId };
        }
        const refusal = fcmRefusalOf(outcome.error);
        if (refusal !== null) {
            this.#deps.log.warn('push registration refused by FCM', { code: refusal });
        }
        return { ok: false, failure: outcome.error, reason: refusal === null ? null : pushReason(refusal), refused: refusal !== null };
    }

    /** The browser's side failed (the SDK, the worker): the code on the page, the code and the SDK's text in the log. */
    #registrarFailed(error: unknown): Attempt {
        const failure = pushFailureOf(error);
        this.#deps.log.warn('push registration failed', { code: failure.code, info: failure.info });
        return { ok: false, failure: { key: NO_REGISTRAR }, reason: pushReason(failure.code), refused: false };
    }

    /** The registrar, when this browser can push and nothing is under way; else null. */
    #usable(): PushRegistrar | null {
        const registrar = this.#deps.registrar;
        const idle = this.#state.device !== 'working' && this.#state.device !== 'unsupported';
        return idle ? registrar : null;
    }

    #set(patch: Partial<PushState>): void {
        this.#state = { ...this.#state, ...patch };
        this.#deps.changed(this.#state);
    }
}
