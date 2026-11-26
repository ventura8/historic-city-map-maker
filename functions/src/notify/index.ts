/**
 * The `notify.*` functions (`docs/research/M4-interfaces.md` §5): the fan-out of every notification event to the admins'
 * inboxes and devices (`onEvent`), and the push callables (`registerDevice`, `unregisterDevice`, `sendTest`).
 * `functions/src/index.ts` exports `notify = notifyFunctions(getDeps)`, which deploys `notify-onEvent`,
 * `notify-registerDevice`, `notify-unregisterDevice` and `notify-sendTest`.
 */
import { registerDeviceFunction, sendTestFunction, unregisterDeviceFunction, type DevicesDeps } from './devices.js';
import { onEventFunction, type FanOutDeps } from './on-event.js';

/** Every port the family uses (the union of its functions' own). */
export type NotifyFamilyDeps = DevicesDeps & FanOutDeps;

export function notifyFunctions(getDeps: () => NotifyFamilyDeps) {
    return {
        registerDevice: registerDeviceFunction(getDeps),
        unregisterDevice: unregisterDeviceFunction(getDeps),
        sendTest: sendTestFunction(getDeps),
        onEvent: onEventFunction(getDeps),
    };
}
