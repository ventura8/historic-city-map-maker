/**
 * The divider of swipe compare as a slider (M4, docs/research/M4-interfaces.md §3.5, `S-V06-HAPPY-KEYBOARD`): its value
 * is the main side's share of the map in whole percent; the arrow keys move it by 1 %, with Shift by 10 %, Page Up and
 * Page Down by 10 %, Home and End to the edges (Esc closes compare, which the element handles). Pure, so the keyboard
 * rules are tested apart from the element.
 */
import { clamp } from '../../components/internal.js';

/** Percent steps of the keys that move the divider (right and up give the main side more of the map). */
const STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };

/** The same keys with Shift held: ten times the arrows' step. */
const SHIFTED_STEPS: Readonly<Record<string, number>> = { ...STEPS, ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10 };

/** The keys that send the divider to an edge. */
const EDGES: Readonly<Record<string, number>> = { Home: 0, End: 1 };

/** The divider's value in whole percent (what `aria-valuenow` says). */
export function dividerPercent(position: number): number {
    return Math.round(clamp(position, 0, 1) * 100);
}

/** `position` moved by `step` percent, on the whole percent, within the map. */
function stepped(position: number, step: number): number {
    return clamp(dividerPercent(position) + step, 0, 100) / 100;
}

/** Where a key moves the divider, or null for a key it ignores (Esc closes compare: the element's, not a move). */
export function dividerKey(key: string, shift: boolean, position: number): number | null {
    const edge = EDGES[key];
    if (edge !== undefined) {
        return edge;
    }
    const step = (shift ? SHIFTED_STEPS : STEPS)[key];
    return step === undefined ? null : stepped(position, step);
}

/** The divider dragged from `start` by `dx` CSS px on a map `width` px wide, on the whole percent (0 wide: where it started). */
export function draggedPosition(start: number, dx: number, width: number): number {
    return width > 0 ? clamp(Math.round((start + dx / width) * 100), 0, 100) / 100 : start;
}
