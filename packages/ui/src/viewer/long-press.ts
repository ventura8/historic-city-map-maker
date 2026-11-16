/**
 * A finger's long press (the owner, 2026-11-15: "long-press on the year pill opens the opacity card"): `HOLD_MS` down
 * without moving more than `SLOP_PX` calls `onHold`; lifting, cancelling or moving first forgets it. A mouse or a pen
 * never holds (they hover). Used by the timeline's thumb (`timeline-opacity.ts`) and the phone's collapsed pill
 * (`timeline-dock.ts`).
 */

/** How long (ms) a finger rests before the press is a hold (iOS's own context press is about 500 ms). */
const HOLD_MS = 500;
/** How far (px) a holding finger may drift. */
const SLOP_PX = 10;

export class LongPress {
    #timer: ReturnType<typeof setTimeout> | undefined;
    #at: { readonly x: number; readonly y: number } | null = null;

    constructor(private readonly onHold: () => void) {}

    /** A pointer went down: a finger starts the wait. */
    start(event: PointerEvent): void {
        this.cancel();
        if (event.pointerType !== 'touch') {
            return;
        }
        this.#at = { x: event.clientX, y: event.clientY };
        document.addEventListener('pointermove', this.#move, true);
        document.addEventListener('pointerup', this.cancel, true);
        document.addEventListener('pointercancel', this.cancel, true);
        this.#timer = setTimeout(() => {
            this.cancel();
            this.onHold();
        }, HOLD_MS);
    }

    readonly cancel = (): void => {
        clearTimeout(this.#timer);
        this.#at = null;
        document.removeEventListener('pointermove', this.#move, true);
        document.removeEventListener('pointerup', this.cancel, true);
        document.removeEventListener('pointercancel', this.cancel, true);
    };

    readonly #move = (event: PointerEvent): void => {
        const at = this.#at;
        if (at !== null && Math.hypot(event.clientX - at.x, event.clientY - at.y) > SLOP_PX) {
            this.cancel();
        }
    };
}
