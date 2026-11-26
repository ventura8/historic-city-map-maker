/**
 * The viewer's key actions in analytics that are not a state change of their own (`docs/ARCHITECTURE.md` → *Wizard
 * funnels*, §200): a pad or a games console's browser in use (`input_device`, once a page each) and an error toast
 * (`ui_error`, by its key). Telemetry sends them only after consent.
 */
import type { MessageKey } from '@hcm/shared';

import type { TelemetryPort } from '../telemetry/telemetry-port.js';

type InputDevice = 'gamepad' | 'console';

/** Reports each input device once a page (`telemetry` is read when one is used: the store's deps are set later). */
export function inputLogger(telemetry: () => Pick<TelemetryPort, 'logEvent'>): (device: InputDevice) => void {
    const seen = new Set<InputDevice>();
    return (device) => {
        if (!seen.has(device)) {
            seen.add(device);
            telemetry().logEvent({ name: 'input_device', device });
        }
    };
}

/** The visitor shared the page (Web Share or the clipboard): the `share` event (CR-17; moved here from the store, §200). */
export function shareLogger(telemetry: () => Pick<TelemetryPort, 'logEvent'>): () => void {
    return () => {
        telemetry().logEvent({ name: 'share' });
    };
}

/** An error toast (`error.…`) is one `ui_error` field measurement by its key; other toasts are not errors. */
export function measureToast(telemetry: Pick<TelemetryPort, 'measure'>, key: MessageKey): void {
    if (key.startsWith('error.')) {
        telemetry.measure?.({ kind: 'ui_error', code: key });
    }
}
