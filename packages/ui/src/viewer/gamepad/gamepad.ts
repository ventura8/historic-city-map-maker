/**
 * The gamepad's lazy chunk (docs/research/viewer-input.md §3; a fake pad in the tests, no real hardware was available):
 * one animation-frame loop while a pad of the standard mapping is connected and the tab is visible. The left stick pans,
 * the right stick turns (across) and zooms (up and down), so do the triggers, each button is a viewer command or a move of the focus (spatial,
 * `../spatial-nav.ts`). A pad of any other mapping is refused once with a toast and never polled.
 */
import type { Logger, MapView, MessageKey } from '@hcm/shared';

import { deepActiveElement, isInert } from '../../components/focus.js';
import type { MapPort } from '../../map/map-port.js';
import type { InputCommand } from '../input-commands.js';
import type { Direction } from '../spatial-nav.js';
import { connectedPads, type PadWindow } from './pads.js';

/** What the session needs from `<hcm-map-viewer>`. */
export interface GamepadSurface {
    readonly renderRoot: Element | DocumentFragment;
    runInput(command: InputCommand): void;
    mapCovered(): boolean;
    toast(key: MessageKey): void;
    /** The D-pad: the focused control's arrow key, or the focus to the nearest control that way. */
    navigate(direction: Direction): void;
    /** A: click what has the focus, or Enter on the map. */
    activate(): void;
}

export interface GamepadDeps {
    readonly win: PadWindow;
    readonly surface: GamepadSurface;
    readonly map: Pick<MapPort, 'getView' | 'flyTo'>;
    readonly log: Pick<Logger, 'warn'>;
}

export interface GamepadSession {
    /** A pad connected or the tab came back: start the loop if there is a usable pad. */
    wake(): void;
    destroy(): void;
}

export interface GamepadModule {
    readonly startGamepad: (deps: GamepadDeps) => GamepadSession;
}

const DEAD_ZONE = 0.15;
const PAN_PX_PER_S = 500;
const ZOOM_PER_S = 1.5;
const TURN_DEG_PER_S = 90;
const MAX_FRAME_MS = 100;
const WORLD_PX = 512;
const LEFT_TRIGGER = 6;
const DPAD: readonly (readonly [number, Direction])[] = [
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
];
const RIGHT_TRIGGER = 7;

/** A stick's two axes, or nothing inside the radial dead zone. */
export function stick(x: number, y: number): readonly [number, number] {
    return Math.hypot(x, y) < DEAD_ZONE ? [0, 0] : [x, y];
}

/** Buttons the Xbox's key emulation already sends as `Gamepad…` keys (`../spatial-nav.ts`): A, B, Y, View, the D-pad. */
const EMULATED = new Set([0, 1, 3, 8, 12, 13, 14, 15]);

/** `view` turned clockwise by `degrees`, the bearing kept in `[0, 360)`. */
export function turnedView(view: MapView, degrees: number): MapView {
    return { ...view, bearing: (((view.bearing + degrees) % 360) + 360) % 360 };
}

/** `view` moved by screen pixels (x right, y down) and zoom levels; Mapbox applies the bounds and the zoom range. */
export function movedView(view: MapView, dx: number, dy: number, dz: number): MapView {
    const degrees = 360 / (WORLD_PX * 2 ** view.zoom);
    const bearing = (view.bearing * Math.PI) / 180;
    const east = dx * Math.cos(bearing) - dy * Math.sin(bearing);
    const north = -dx * Math.sin(bearing) - dy * Math.cos(bearing);
    const [lng, lat] = view.center;
    return {
        ...view,
        center: [lng + east * degrees, lat + north * degrees * Math.cos((lat * Math.PI) / 180)],
        zoom: view.zoom + dz,
    };
}

function isStandard(pad: Gamepad): boolean {
    return pad.mapping === 'standard';
}

function axisValue(pad: Gamepad, index: number): number {
    return pad.axes[index] ?? 0;
}

function buttonValue(pad: Gamepad, index: number): number {
    return pad.buttons[index]?.value ?? 0;
}

function held(pad: Gamepad): ReadonlySet<number> {
    return new Set(pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])));
}

/** One listener per element however many frames ask: the browser keeps a function only once. */
function clearRing(event: Event): void {
    (event.currentTarget as HTMLElement).style.outline = '';
}

function isControl(element: Element | null, body: HTMLElement): element is HTMLElement {
    return element instanceof HTMLElement && element !== body;
}

class Session implements GamepadSession {
    readonly #deps: GamepadDeps;
    readonly #buttons: ReadonlyMap<number, () => void>;
    #frame: number | null = null;
    #last: number | null = null;
    #held: ReadonlySet<number> = new Set();
    #greeted = false;
    #refused = false;
    #pressed = false;

    readonly #onVisibility = (): void => {
        if (this.#deps.win.document.hidden) {
            this.#stop();
        } else {
            this.wake();
        }
    };

    constructor(deps: GamepadDeps) {
        this.#deps = deps;
        const command = (name: InputCommand) => (): void => {
            if (!this.#menuOpen()) {
                deps.surface.runInput(name);
            }
        };
        this.#buttons = new Map([
            [
                0,
                () => {
                    deps.surface.activate();
                },
            ],
            [
                1,
                () => {
                    this.#close();
                },
            ],
            [3, command('layers')],
            [4, command('photo-previous')],
            [5, command('photo-next')],
            [8, command('help')],
            [
                9,
                () => {
                    this.#openMenu();
                },
            ],
            ...DPAD.map(([index, direction]): [number, () => void] => [
                index,
                () => {
                    deps.surface.navigate(direction);
                },
            ]),
        ]);
        deps.win.document.addEventListener('visibilitychange', this.#onVisibility);
    }

    wake(): void {
        const pads = connectedPads(this.#deps.win);
        if (pads.some(isStandard)) {
            if (!this.#greeted) {
                this.#greeted = true;
                this.#deps.surface.toast('gamepad.ready');
            }
            this.#run();
        } else if (pads.length > 0 && !this.#refused) {
            this.#refused = true;
            this.#deps.surface.toast('gamepad.refused');
        }
    }

    #run(): void {
        if (this.#frame === null && !this.#deps.win.document.hidden) {
            this.#last = null;
            this.#schedule();
        }
    }

    #schedule(): void {
        this.#frame = this.#deps.win.requestAnimationFrame((now) => {
            this.#tick(now);
        });
    }

    #stop(): void {
        if (this.#frame !== null) {
            this.#deps.win.cancelAnimationFrame(this.#frame);
            this.#frame = null;
        }
    }

    #tick(now: number): void {
        this.#frame = null;
        const pad = connectedPads(this.#deps.win).find(isStandard);
        if (pad === undefined) {
            return;
        }
        if (this.#last !== null) {
            this.#move(pad, Math.min(now - this.#last, MAX_FRAME_MS) / 1000);
            this.#press(pad);
            this.#ringFocus();
        }
        this.#held = held(pad);
        this.#last = now;
        this.#schedule();
    }

    #press(pad: Gamepad): void {
        const now = held(pad);
        for (const [index, action] of this.#live()) {
            if (now.has(index) && !this.#held.has(index)) {
                this.#pressed = true;
                action();
            }
        }
    }

    /** The buttons this loop acts on: under the Xbox's key emulation, not those that arrive as keys. */
    #live(): Iterable<readonly [number, () => void]> {
        const nav = this.#deps.win.navigator as Partial<Record<'gamepadInputEmulation', string>>;
        return nav.gamepadInputEmulation === 'keyboard' ? [...this.#buttons].filter(([index]) => !EMULATED.has(index)) : this.#buttons;
    }

    /**
     * Once the pad is in use, the ring of what has the focus, whichever command moved it and however many frames later:
     * `:focus-visible` shows none on a programmatic focus after a mouse click.
     */
    #ringFocus(): void {
        const active = this.#active();
        if (this.#pressed && isControl(active, this.#deps.win.document.body)) {
            active.style.outline = 'var(--hcm-focus-ring-width, 3px) solid var(--md-sys-color-secondary)';
            active.addEventListener('blur', clearRing, { once: true });
        }
    }

    #move(pad: Gamepad, seconds: number): void {
        const { surface, map } = this.#deps;
        const [panX, panY] = stick(axisValue(pad, 0), axisValue(pad, 1));
        const [turn, zoomY] = stick(axisValue(pad, 2), axisValue(pad, 3));
        const zoom = buttonValue(pad, RIGHT_TRIGGER) - buttonValue(pad, LEFT_TRIGGER) - zoomY;
        if (Math.hypot(panX, panY, zoom, turn) === 0 || surface.mapCovered()) {
            return;
        }
        const pixels = PAN_PX_PER_S * seconds;
        const moved = movedView(map.getView(), panX * pixels, panY * pixels, zoom * ZOOM_PER_S * seconds);
        map.flyTo(turnedView(moved, turn * TURN_DEG_PER_S * seconds), { animate: false });
    }

    #fab(): HTMLElement | null {
        return this.#deps.surface.renderRoot.querySelector('hcm-fab-menu')?.shadowRoot?.querySelector<HTMLElement>('.fab') ?? null;
    }

    /** Not under a modal surface: `click()` fires on an inert element too, and a hidden menu would take the next B. */
    #openMenu(): void {
        const fab = this.#fab();
        if (fab !== null && !isInert(fab)) {
            fab.click();
        }
    }

    #menuOpen(): boolean {
        return this.#deps.surface.renderRoot.querySelector('hcm-fab-menu')?.hasAttribute('open') === true;
    }

    #active(): Element | null {
        return deepActiveElement(this.#deps.win.document);
    }

    #close(): void {
        if (this.#menuOpen()) {
            this.#fab()?.click();
        } else {
            this.#deps.surface.runInput('close');
        }
    }

    destroy(): void {
        this.#stop();
        this.#deps.win.document.removeEventListener('visibilitychange', this.#onVisibility);
    }
}

export function startGamepad(deps: GamepadDeps): GamepadSession {
    return new Session(deps);
}
