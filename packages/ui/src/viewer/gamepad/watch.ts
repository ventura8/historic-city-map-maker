/**
 * The entry's part of the gamepad (docs/research/viewer-input.md §3): it listens for a pad and fetches the lazy chunk
 * (`gamepad.ts`, emitted as `gamepad-<hash>.js`) only once one connects; a failed fetch is tried again at the next one.
 */
import type { GamepadDeps, GamepadModule, GamepadSession } from './gamepad.js';
import { connectedPads, type PadWindow } from './pads.js';

export function watchGamepads(win: PadWindow, load: () => Promise<GamepadModule>, deps: Omit<GamepadDeps, 'win'>): () => void {
    let session: Promise<GamepadSession> | null = null;
    const wake = (): void => {
        session ??= load().then((chunk) => chunk.startGamepad({ ...deps, win }));
        session.then(
            (started) => {
                started.wake();
            },
            (error: unknown) => {
                session = null;
                deps.log.warn('gamepad could not start', { error: String(error) });
            },
        );
    };
    win.addEventListener('gamepadconnected', wake);
    if (connectedPads(win).length > 0) {
        wake();
    }
    return () => {
        win.removeEventListener('gamepadconnected', wake);
        session?.then(
            (started) => {
                started.destroy();
            },
            () => undefined,
        );
    };
}
