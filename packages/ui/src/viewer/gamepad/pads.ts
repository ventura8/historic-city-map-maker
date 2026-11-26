/**
 * The pads the browser reveals (docs/research/viewer-input.md §3). The Gamepad API lists empty slots as null, may be
 * missing, and throws in a cross-origin frame without the `gamepad` permission: each of those reads as no pads.
 */
export type PadWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'requestAnimationFrame' | 'cancelAnimationFrame'> & {
    readonly navigator: Pick<Navigator, 'getGamepads'>;
    readonly document: Document;
};

export function connectedPads(win: Pick<PadWindow, 'navigator'>): readonly Gamepad[] {
    try {
        return win.navigator.getGamepads().filter((pad) => pad !== null);
    } catch {
        return [];
    }
}
