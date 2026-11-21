/**
 * The visitor's theme choices in Settings: the mode (Follow my device, Light, Dark; the `theme_change` event) and the
 * colours (Device accent, Map colours), each remembered for the city (`preferences.ts`). A choice the state already holds
 * changes nothing.
 */
import type { AccentChoice } from '@hcm/ui';

import type { ViewerDeps } from './deps.js';
import type { Preferences } from './preferences.js';
import type { ThemeMode, ViewerState } from './state.js';

/** The part of the store a choice needs. */
export interface ThemeChoiceHost {
    readonly deps: ViewerDeps;
    readonly preferences: Preferences;
    getState(): ViewerState;
    set(next: ViewerState): void;
}

function cityOf(host: ThemeChoiceHost): string | undefined {
    return host.getState().manifest?.city.id ?? host.deps.config.cityId;
}

/** `setTheme`: the mode, logged as `theme_change` and stored as `theme`. */
export function themeChooser(host: ThemeChoiceHost): (theme: ThemeMode) => void {
    return (theme) => {
        if (theme !== host.getState().theme) {
            host.set({ ...host.getState(), theme });
            host.deps.telemetry.logEvent({ name: 'theme_change', theme });
            host.preferences.set(cityOf(host), 'theme', theme);
        }
    };
}

/** `setAccent`: the colours, stored as `accent`. */
export function accentChooser(host: ThemeChoiceHost): (accent: AccentChoice) => void {
    return (accent) => {
        if (accent !== host.getState().accent) {
            host.set({ ...host.getState(), accent });
            host.preferences.set(cityOf(host), 'accent', accent);
        }
    };
}
