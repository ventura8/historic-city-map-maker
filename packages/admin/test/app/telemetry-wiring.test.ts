import { createLogger } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { AdminTelemetry } from '../../src/app/telemetry.js';
import { startTelemetry, type TelemetryView } from '../../src/app/telemetry-wiring.js';
import type { AdminState } from '../../src/state/state.js';
import { Store } from '../../src/state/store.js';

const log = createLogger('telemetry-wiring-test', { sink: () => undefined });

/** The fields the wiring and its watches read; the rest of the state does not matter here. */
function store(cityId: string | null): Store<AdminState<null>> {
    const state = {
        locale: 'ro',
        windowClass: 'compact',
        mode: 'normal',
        cityId,
        cities: [{ id: 'bucharest', role: 'moderator' }],
        auth: 'starting',
        setup: null,
        notice: null,
        route: { id: 'setup', params: [] },
    };
    return new Store(state as unknown as AdminState<null>, log);
}

function started(cityId: string | null): TelemetryView {
    const seen: TelemetryView[] = [];
    const telemetry = { consent: 'unknown', available: false, measure: () => undefined } as unknown as AdminTelemetry;
    const { stop } = startTelemetry(
        {
            telemetry: (view) => {
                seen.push(view);
                return telemetry;
            },
            log,
        },
        store(cityId),
    );
    stop();
    const [view] = seen;
    if (view === undefined) {
        throw new Error('the telemetry was not created');
    }
    return view;
}

describe('startTelemetry', () => {
    // §203: GA4's app_surface is the signed-in account's role on the open city.
    it('happyPath_theViewNamesTheRoleOnTheOpenCity_andWhatTheAppShows', () => {
        const view = started('bucharest');

        expect([view.role(), view.locale(), view.windowClass(), view.serverAnswers()]).toEqual(['moderator', 'ro', 'compact', true]);
    });

    it('badPath_noRoleBeforeACityTheAccountHasIsOpen', () => {
        expect([started(null).role(), started('bacau').role()]).toEqual([null, null]);
    });
});
