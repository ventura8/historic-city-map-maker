/**
 * Whether anybody uses the admin's tab (the owner, 2026-11-14: the installed app updates itself at a safe moment,
 * `./release-reload.ts`): no pointer pressed (a drag on the georeferencer, a slider) and no press, key or wheel for
 * `IDLE_MS`. The clock is injected, so no test waits on the wall clock.
 */
import type { Clock } from './ports.js';

/** A visible tab is idle once nobody pressed, typed or scrolled for this long. */
export const IDLE_MS = 60_000;

/** What the watch uses of `window`. */
export interface ActivityWindow {
    addEventListener(type: string, listener: () => void, options: { readonly capture: boolean; readonly passive: boolean }): void;
}

/** Starts watching `win`'s input; the result says whether the tab is idle now. */
export function watchActivity(win: ActivityWindow, clock: Pick<Clock, 'now'>): () => boolean {
    const at = { pressed: false, input: clock.now() };
    const touched = (pressed: boolean) => (): void => {
        at.pressed = pressed;
        at.input = clock.now();
    };
    const options = { capture: true, passive: true };
    win.addEventListener('pointerdown', touched(true), options);
    for (const type of ['pointerup', 'pointercancel', 'keydown', 'wheel']) {
        win.addEventListener(type, touched(false), options);
    }
    return () => !at.pressed && clock.now() - at.input >= IDLE_MS;
}
