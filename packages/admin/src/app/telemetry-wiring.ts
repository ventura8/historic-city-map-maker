/**
 * Telemetry over the app's state (moved out of `mount.ts`, §200): the language, the window class, whether the server
 * answers; the field measurements of the state (`field.ts`, §76) and the wizard funnels and shown errors (`funnels.ts`)
 * follow it for as long as the store lives.
 */
import type { CityRole, Logger } from '@hcm/shared';
import type { FunnelWindow } from '@hcm/shared/funnels';

import type { AdminState } from '../state/state.js';
import type { Store } from '../state/store.js';
import { FieldWatch } from './field.js';
import { watchFunnels } from './funnels.js';
import type { AdminTelemetry, Measure } from './telemetry.js';

/** What crash reports need to know of the app while it runs. */
export interface TelemetryView {
    locale(): string;
    windowClass(): string;
    /** The server answers (normal mode): only then does the crash endpoint exist. */
    serverAnswers(): boolean;
    /** §203: the signed-in account's role on the open city (GA4's `app_surface`), null before one is known. */
    role(): CityRole | null;
}

/** The parts of the app's dependencies telemetry needs (`AdminDeps` of `mount.ts`). */
interface TelemetryWiringDeps {
    readonly telemetry: (view: TelemetryView) => AdminTelemetry;
    /** The page's window, where the wizards' funnel signals arrive; none: no funnels. */
    readonly funnelWindow?: FunnelWindow;
    readonly log: Logger;
}

/** The field measurements of `field.ts`, through telemetry (§76). */
export function measureOf(telemetry: AdminTelemetry): Measure {
    return (event) => {
        telemetry.measure(event);
    };
}

/** The app's telemetry with its watches; `stop` ends the funnels' and notices' watch (the field watch ends with the store). */
export function startTelemetry<Setup>(
    deps: TelemetryWiringDeps,
    store: Store<AdminState<Setup>>,
): { readonly telemetry: AdminTelemetry; readonly stop: () => void } {
    const telemetry = deps.telemetry({
        locale: () => store.state.locale,
        windowClass: () => store.state.windowClass,
        serverAnswers: () => store.state.mode === 'normal',
        role: () => store.state.cities.find((city) => city.id === store.state.cityId)?.role ?? null,
    });
    store.update({ consent: telemetry.consent, analytics: telemetry.available });
    const now = (): number => globalThis.performance.now();
    const field = new FieldWatch(measureOf(telemetry), now);
    field.observe(store.state);
    store.subscribe((state) => {
        field.observe(state);
    });
    const stop = watchFunnels({ measure: measureOf(telemetry), win: deps.funnelWindow ?? null, now, log: deps.log }, store);
    return { telemetry, stop };
}
