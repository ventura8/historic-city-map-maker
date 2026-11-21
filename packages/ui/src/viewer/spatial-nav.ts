/**
 * Spatial navigation for a TV remote, a games console's D-pad and the arrow keys (docs/research/viewer-input.md §6): an
 * arrow on a control that has no use for it moves the focus to the nearest control on screen in that direction, so the
 * focus follows the layout. Controls that own their arrows keep them: text, the map (Mapbox pans), a menu, and
 * every component that handles a key cancels it first. The Xbox's key emulation names its buttons (`GamepadA`,
 * `GamepadDPadUp`, ...): they act like the standard gamepad's (`gamepad/gamepad.ts`).
 */
import { deepActiveElement, isInert, tabbableElements } from '../components/focus.js';
import type { InputCommand } from './input-commands.js';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** What the viewer offers to spatial navigation (`<hcm-map-viewer>`). */
export interface SpatialViewer extends HTMLElement {
    runInput(command: InputCommand): void;
    mapCovered(): boolean;
}

const ARROWS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const PAD_ARROWS: Readonly<Record<string, Direction>> = {
    GamepadDPadUp: 'up',
    GamepadDPadDown: 'down',
    GamepadDPadLeft: 'left',
    GamepadDPadRight: 'right',
};
const KEY_OF: Readonly<Record<Direction, string>> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const PAD_COMMANDS: Readonly<Record<string, InputCommand>> = { GamepadB: 'close', GamepadY: 'layers', GamepadView: 'help' };

/** Where the arrows are the control's own: typing, the map, a select, a menu. */
const OWN_ARROWS = 'input,textarea,select,canvas,[contenteditable],[role=textbox],[role=searchbox],[role=combobox],[role^=menuitem]';

interface Box {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

/** Each direction turned to "down": a box as seen when that direction points down the screen. */
const TURNED: Readonly<Record<Direction, (box: Box) => Box>> = {
    down: (box) => box,
    up: (box) => ({ left: box.left, right: box.right, top: -box.bottom, bottom: -box.top }),
    right: (box) => ({ left: box.top, right: box.bottom, top: box.left, bottom: box.right }),
    left: (box) => ({ left: box.top, right: box.bottom, top: -box.right, bottom: -box.left }),
};

/**
 * How far `to` is from `from` going `direction`, or null when it is not that way at all: the gap ahead, the gap across
 * counted twice (a control in line wins over a nearer one beside it), and the offset of the centres as a tie-break.
 */
export function distance(from: Box, to: Box, direction: Direction): number | null {
    const start = TURNED[direction](from);
    const end = TURNED[direction](to);
    if (end.top + end.bottom <= start.top + start.bottom) {
        return null;
    }
    const ahead = Math.max(0, end.top - start.bottom);
    const across = Math.max(0, end.left - start.right, start.left - end.right);
    return ahead + 2 * across + Math.abs(end.left + end.right - start.left - start.right) / 8;
}

/**
 * Whether `outer` holds the middle of `inner`: the map's canvas, a scrolling pane. Such a box is around the focus, not
 * beside it, and is never a step's target (the map is reached with Tab, or A with nothing focused).
 */
export function encloses(outer: Box, inner: Box): boolean {
    const x = (inner.left + inner.right) / 2;
    const y = (inner.top + inner.bottom) / 2;
    return outer.left <= x && x <= outer.right && outer.top <= y && y <= outer.bottom;
}

/** The nearest of `candidates` going `direction` from `from`, or null with none that way. */
export function nearest(from: Box, candidates: readonly HTMLElement[], direction: Direction): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const box = candidate.getBoundingClientRect();
        const away = encloses(box, from) ? null : distance(from, box, direction);
        if (away !== null && away < bestDistance) {
            best = candidate;
            bestDistance = away;
        }
    }
    return best;
}

/** The focused element when it is inside `viewer`'s shadow tree, else null. */
function activeIn(viewer: HTMLElement): HTMLElement | null {
    const active = deepActiveElement(viewer.ownerDocument);
    if (!(active instanceof HTMLElement)) {
        return null;
    }
    return viewer.shadowRoot?.contains(rootHostIn(active, viewer)) === true ? active : null;
}

/** The focused control inside `viewer`, not the map's canvas (a move from the map starts from the middle). */
function controlIn(viewer: HTMLElement): HTMLElement | null {
    const active = activeIn(viewer);
    return active?.localName === 'canvas' ? null : active;
}

/** `element`, or the host of the shadow tree it sits in, up to the one directly in `viewer`'s shadow root. */
function rootHostIn(element: Element, viewer: HTMLElement): Element {
    const root = element.getRootNode();
    return root instanceof ShadowRoot && root.host !== viewer ? rootHostIn(root.host, viewer) : element;
}

/** A point at the middle of `viewer`: where a move starts on the map or with nothing focused. */
function middleOf(viewer: HTMLElement): Box {
    const box = viewer.getBoundingClientRect();
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    return { left: x, right: x, top: y, bottom: y };
}

/** Moves the focus to the nearest reachable control going `direction`; true when it moved. */
export function moveFocus(viewer: HTMLElement, direction: Direction): boolean {
    const root = viewer.shadowRoot;
    if (root === null) {
        return false;
    }
    const active = activeIn(viewer);
    const control = controlIn(viewer);
    const from = control === null ? middleOf(viewer) : control.getBoundingClientRect();
    const reachable = tabbableElements(root).filter((element) => element !== active && !isInert(element));
    const target = nearest(from, reachable, direction);
    target?.focus();
    return target !== null;
}

/** A horizontal slider (the timeline, an opacity) keeps left and right; up and down leave it. */
function crossesSlider(element: HTMLElement, direction: Direction): boolean {
    const vertical = element.getAttribute('aria-orientation') === 'vertical';
    return element.getAttribute('role') === 'slider' && vertical === (direction === 'left' || direction === 'right');
}

/**
 * A D-pad press (the gamepad, or the Xbox's key emulation): the focused control gets the arrow key, and acts or lets
 * the viewer move the focus (`arrowKey`); from the map or with nothing focused the focus moves from the middle.
 */
export function navigate(viewer: HTMLElement, direction: Direction): void {
    const active = controlIn(viewer);
    if (active === null || crossesSlider(active, direction)) {
        moveFocus(viewer, direction);
        return;
    }
    active.dispatchEvent(new KeyboardEvent('keydown', { key: KEY_OF[direction], bubbles: true, composed: true, cancelable: true }));
}

/** A or Enter from the pad: what has the focus is clicked; on the map or with nothing focused, Enter on the map. */
export function activate(viewer: SpatialViewer): void {
    const control = controlIn(viewer);
    if (control !== null) {
        control.click();
    } else if (!viewer.mapCovered()) {
        enterOnMap(viewer.shadowRoot?.querySelector('canvas') ?? null);
    }
}

/** What Enter does on the map: the photo or place at its centre (`map/pointer.ts`). */
function enterOnMap(canvas: HTMLCanvasElement | null): void {
    canvas?.focus();
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
}

function isModified(event: KeyboardEvent): boolean {
    return event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented;
}

/** An arrow key from inside `viewer` that no control took: the focus moves; true when the viewer used it. */
function arrowKey(viewer: HTMLElement, event: KeyboardEvent, direction: Direction): boolean {
    const [target] = event.composedPath();
    const owned = target instanceof Element && target.matches(OWN_ARROWS);
    return !owned && event.composedPath().includes(viewer) && moveFocus(viewer, direction);
}

/** What a key of the Xbox's gamepad emulation (`navigator.gamepadInputEmulation = 'keyboard'`) does, or null. */
function padAction(viewer: SpatialViewer, key: string): (() => void) | null {
    const direction = PAD_ARROWS[key];
    if (direction !== undefined) {
        return () => {
            navigate(viewer, direction);
        };
    }
    const command = PAD_COMMANDS[key];
    if (command !== undefined) {
        return () => {
            viewer.runInput(command);
        };
    }
    return key === 'GamepadA'
        ? () => {
              activate(viewer);
          }
        : null;
}

function padKey(viewer: SpatialViewer, event: KeyboardEvent, isPadKeyFor: (viewer: Element, event: KeyboardEvent) => boolean): boolean {
    const action = padAction(viewer, event.key);
    if (action === null || !isPadKeyFor(viewer, event)) {
        return false;
    }
    action();
    return true;
}

/**
 * The viewer's keydown for spatial navigation (`isPadKeyFor` says whether a pad key from the page's body is this
 * viewer's): the event is cancelled when the viewer used it.
 */
export function spatialKey(
    viewer: SpatialViewer,
    event: KeyboardEvent,
    isPadKeyFor: (viewer: Element, event: KeyboardEvent) => boolean,
): void {
    if (isModified(event)) {
        return;
    }
    const direction = ARROWS[event.key];
    const used = direction === undefined ? padKey(viewer, event, isPadKeyFor) : arrowKey(viewer, event, direction);
    if (used) {
        event.preventDefault();
    }
}

/**
 * On the Xbox's legacy Edge the controller is a mouse cursor until the page asks for keys: then the D-pad, A, B and Y
 * arrive as `Gamepad…` keys and the focus moves. A browser without the property (Chromium Edge, every other) keeps its
 * cursor; nothing is set there.
 */
export function askForPadKeys(nav: Navigator): void {
    if ('gamepadInputEmulation' in nav) {
        Object.assign(nav, { gamepadInputEmulation: 'keyboard' });
    }
}
