/**
 * The colours the viewer wears: the city's theme over the baseline (`viewer-baseline.ts`), in the device's accent unless
 * the visitor chose the map's own colours (`theme/device-accent.ts`; the default follows the device).
 */
import type { ThemeTokens } from '@hcm/shared';

import { accentTokens } from '../theme/device-accent.js';
import type { ViewerState } from './store-port.js';
import { withViewerBaseline } from './viewer-baseline.js';

/** The tokens of `state` (the baseline in the device's accent before a store is attached). */
export function viewerTokens(state: ViewerState | null, doc: Document): ThemeTokens {
    return accentTokens(withViewerBaseline(state?.manifest?.city.theme.tokens), state?.accent ?? 'device', doc);
}

/** Whether the theme must be applied again (and the device's accent read again): the mode, the colours or the city changed. */
export function themeChanged(previous: ViewerState, state: ViewerState): boolean {
    return (['theme', 'accent', 'manifest'] as const).some((key) => previous[key] !== state[key]);
}
