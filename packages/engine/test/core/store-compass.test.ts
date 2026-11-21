import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isNorthUp } from '../../src/core/compass.js';
import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { harness, loaded } from './harness.js';

/**
 * The compass (scenario V64): `watchCamera` hands the needle the camera's bearing and tilt now and on every `move`, and
 * `resetNorth` turns the camera back to north up and level; the address follows the camera's `moveend`.
 */
describe('the compass', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_resetNorthTurnsAndLevelsTheCameraAndTheAddressDropsTheBearing', async () => {
        const { store, map, location } = await loaded();
        map.view = { center: [26.1, 44.43], zoom: 14, bearing: 45 };
        map.pitch = 30;

        store.resetNorth();
        map.emit('moveend', map.view);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(map.callsOf('flyTo').at(-1)).toEqual([{ bearing: 0 }, { pitch: 0, animate: true }]);
        expect(map.pitch).toBe(0);
        expect(location.hash.split('&')[0]).toBe('#14/44.43/26.1');
    });

    it('happyPath_aResetThatTurnsTheMapIsOneCompassEvent', async () => {
        // @S-V70-HAPPY-KEY-ACTIONS: the compass's reset is counted (after consent, by telemetry).
        const { store, map, telemetry } = await loaded();
        map.view = { ...map.view, bearing: 90 };

        store.resetNorth();
        store.resetNorth();

        expect(telemetry.events.filter((event) => event.name === 'compass_reset')).toEqual([{ name: 'compass_reset' }]);
    });

    it('happyPath_reducedMotionJumps', async () => {
        const { store, map } = await loaded({ reducedMotion: true });
        map.view = { ...map.view, bearing: 300 };

        store.resetNorth();

        expect(map.callsOf('flyTo').at(-1)).toEqual([{ bearing: 0 }, { pitch: 0, animate: false }]);
    });

    it('happyPath_onlyATiltIsLevelledToo', async () => {
        const { store, map } = await loaded();
        map.pitch = 20;

        store.resetNorth();

        expect(map.pitch).toBe(0);
    });

    it('badPath_alreadyNorthUpNothingMoves', async () => {
        const { store, map } = await loaded();
        map.view = { ...map.view, bearing: 359.98 };
        const flights = map.callsOf('flyTo').length;

        store.resetNorth();

        expect(map.callsOf('flyTo')).toHaveLength(flights);
    });

    it('badPath_beforeTheMapNothingMoves', () => {
        const { store, map } = harness();
        map.view = { ...map.view, bearing: 90 };

        store.resetNorth();

        expect(map.callsOf('flyTo')).toEqual([]);
    });

    it('happyPath_watchCameraGivesTheCameraNowAndOnEveryMoveUntilStopped', async () => {
        const { store, map } = await loaded();
        map.view = { ...map.view, bearing: 10 };
        const seen: unknown[] = [];

        const stop = store.watchCamera((camera) => seen.push(camera));
        map.pitch = 15;
        map.emit('move', { ...map.view, bearing: 20 });
        stop();
        map.emit('move', { ...map.view, bearing: 30 });

        expect(seen).toEqual([
            { bearing: 10, pitch: 0 },
            { bearing: 20, pitch: 15 },
        ]);
    });

    it('badPath_isNorthUpOnlyWithinATwentiethOfADegree', () => {
        expect(isNorthUp({ bearing: 0.04, pitch: 0 })).toBe(true);
        expect(isNorthUp({ bearing: 359.96, pitch: 0.01 })).toBe(true);
        expect(isNorthUp({ bearing: 0.1, pitch: 0 })).toBe(false);
        expect(isNorthUp({ bearing: 0, pitch: 1 })).toBe(false);
    });
});
