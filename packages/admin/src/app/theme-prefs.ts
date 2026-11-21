/**
 * The admin's theme choices on this browser (`localStorage`, like the language): the mode (Follow my device, Light, Dark)
 * and the colours (Device accent, Map colours; `@hcm/ui`'s `theme/device-accent.ts`), the same rule as the viewer's.
 */
import type { AccentChoice, AdminState, ThemeMode } from '../state/state.js';
import type { KeyValueStore } from './ports.js';

/** `localStorage`: the theme the admin chose (`system` by default). */
export const THEME_KEY = 'hcm:admin:theme';
/** `localStorage`: the colours the admin chose (`device`, the device's accent, by default). */
export const ACCENT_KEY = 'hcm:admin:accent';

/** The stored theme (`system` for anything else). */
function themeModeOf(value: string | null): ThemeMode {
    return value === 'light' || value === 'dark' ? value : 'system';
}

/** The theme's two choices: each is stored on this browser and shown at once. */
export function themeIntents(
    local: Pick<KeyValueStore, 'set'>,
    current: () => AdminState['theme'],
    show: (patch: { readonly theme: AdminState['theme'] }) => void,
): { setTheme(mode: ThemeMode): void; setAccent(accent: AccentChoice): void } {
    return {
        setTheme: (mode) => {
            local.set(THEME_KEY, mode);
            show({ theme: { ...current(), mode } });
        },
        setAccent: (accent) => {
            local.set(ACCENT_KEY, accent);
            show({ theme: { ...current(), accent } });
        },
    };
}

/** The stored theme choices on this browser (Follow my device and Device accent unless chosen otherwise), no city yet. */
export function storedTheme(local: Pick<KeyValueStore, 'get'>): AdminState['theme'] {
    const accent = local.get(ACCENT_KEY) === 'map' ? 'map' : 'device';
    return { mode: themeModeOf(local.get(THEME_KEY)), accent, city: null, preview: null };
}
