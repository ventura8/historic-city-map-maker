import { afterEach, describe, expect, it, vi } from 'vitest';

import { isGameConsole } from '../../src/viewer/game-console.js';
import type { InputCommand } from '../../src/viewer/input-commands.js';
import {
    activate,
    askForPadKeys,
    distance,
    encloses,
    moveFocus,
    navigate,
    nearest,
    spatialKey,
    type SpatialViewer,
} from '../../src/viewer/spatial-nav.js';
import { isViewerKey } from '../../src/viewer/viewer-keyboard.js';

interface Stage {
    readonly viewer: SpatialViewer;
    readonly root: ShadowRoot;
    readonly commands: InputCommand[];
    covered: boolean;
}

/**
 * A viewer of 600 × 400 px at the page's corner with controls placed like the real one's: the menu top right, two
 * buttons in a row at the top left, the timeline's slider at the bottom, the map's canvas under all of them.
 */
function stage(): Stage {
    const host = document.createElement('section') as unknown as SpatialViewer;
    const commands: InputCommand[] = [];
    const state: Stage = { viewer: host, root: host.attachShadow({ mode: 'open' }), commands, covered: false };
    Object.assign(host, {
        runInput: (command: InputCommand) => {
            commands.push(command);
        },
        mapCovered: () => state.covered,
    });
    host.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;display:block';
    document.body.append(host);
    return state;
}

function place(s: Stage, tag: string, id: string, [left, top, width, height]: readonly [number, number, number, number]): HTMLElement {
    const element = document.createElement(tag);
    element.id = id;
    element.tabIndex = 0;
    element.style.cssText = `position:absolute;left:${String(left)}px;top:${String(top)}px;width:${String(width)}px;height:${String(height)}px`;
    s.root.append(element);
    return element;
}

function layout(s: Stage): Record<'canvas' | 'menu' | 'first' | 'second' | 'slider', HTMLElement> {
    const canvas = place(s, 'canvas', 'canvas', [0, 0, 600, 400]);
    const menu = place(s, 'button', 'menu', [540, 10, 48, 48]);
    const first = place(s, 'button', 'first', [10, 10, 48, 48]);
    const second = place(s, 'button', 'second', [70, 10, 48, 48]);
    const slider = place(s, 'div', 'slider', [100, 330, 400, 48]);
    slider.setAttribute('role', 'slider');
    return { canvas, menu, first, second, slider };
}

function activeId(s: Stage): string | undefined {
    return s.root.activeElement?.id;
}

/** A key pressed on `target` as the browser would, with the viewer's listener on the document. */
function press(s: Stage, target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init });
    const listener = (seen: Event): void => {
        spatialKey(s.viewer, seen as KeyboardEvent, isViewerKey);
    };
    document.addEventListener('keydown', listener);
    target.dispatchEvent(event);
    document.removeEventListener('keydown', listener);
    return event;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('distance and nearest', () => {
    const from = { left: 0, right: 10, top: 0, bottom: 10 };

    it('badPath_whatLiesBehindIsNotThatWay', () => {
        expect(distance(from, { left: -20, right: -10, top: 0, bottom: 10 }, 'right')).toBeNull();
        expect(distance(from, { left: 0, right: 10, top: -30, bottom: -20 }, 'down')).toBeNull();
    });

    it('happyPath_aControlInLineWinsOverANearerOneBeside', () => {
        const inLine = { left: 0, right: 10, top: 100, bottom: 110 };
        const beside = { left: 60, right: 70, top: 40, bottom: 50 };
        const down = [inLine, beside].map((box) => distance(from, box, 'down') ?? Number.NaN);
        expect(down[0]).toBeLessThan(down[1] ?? 0);
        expect(distance(from, { left: -30, right: -20, top: 0, bottom: 10 }, 'left')).toBe(20);
        expect(distance(from, { left: 0, right: 10, top: -30, bottom: -20 }, 'up')).toBe(20);
    });

    it('badPath_aBoxAroundTheFocusIsNoStep', () => {
        const around = { left: -50, right: 150, top: -50, bottom: 150 };
        expect(encloses(around, from)).toBe(true);
        expect(encloses(from, around)).toBe(false);
    });

    it('edge_noCandidateThatWayIsNull', () => {
        expect(nearest(from, [], 'left')).toBeNull();
    });
});

describe('arrow keys', () => {
    it('happyPath_theFocusFollowsTheLayout', () => {
        const s = stage();
        const { first, slider } = layout(s);
        first.focus();

        expect(press(s, first, 'ArrowRight').defaultPrevented).toBe(true);
        expect(activeId(s)).toBe('second');
        press(s, s.root.activeElement ?? first, 'ArrowRight');
        expect(activeId(s)).toBe('menu');
        press(s, s.root.activeElement ?? first, 'ArrowDown');
        expect(activeId(s)).toBe('slider');
        expect(slider.matches(':focus')).toBe(true);
    });

    it('badPath_theMapAndTypingKeepTheirArrows', () => {
        const s = stage();
        const { canvas } = layout(s);
        const field = place(s, 'input', 'field', [10, 200, 100, 30]);
        canvas.focus();
        expect(press(s, canvas, 'ArrowUp').defaultPrevented).toBe(false);
        expect(activeId(s)).toBe('canvas');

        field.focus();
        expect(press(s, field, 'ArrowUp').defaultPrevented).toBe(false);
        expect(activeId(s)).toBe('field');
    });

    it('badPath_aKeyAControlTookOrAModifiedOneMovesNothing', () => {
        const s = stage();
        const { first } = layout(s);
        first.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
            }
        });
        first.focus();

        press(s, first, 'ArrowDown');
        press(s, first, 'ArrowRight', { shiftKey: true });

        expect(activeId(s)).toBe('first');
    });

    it('edge_anArrowFromOutsideTheViewerOrWithNothingThatWayIsTheBrowsers', () => {
        const s = stage();
        const { first } = layout(s);
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        expect(press(s, outside, 'ArrowDown').defaultPrevented).toBe(false);

        first.focus();
        expect(press(s, first, 'ArrowLeft').defaultPrevented).toBe(false);
        expect(activeId(s)).toBe('first');
    });

    it('edge_inertControlsAreNeverReached', () => {
        const s = stage();
        const { first, second } = layout(s);
        second.setAttribute('inert', '');
        first.focus();

        press(s, first, 'ArrowRight');

        expect(activeId(s)).toBe('menu');
    });

    it('edge_noShadowRootNoMove', () => {
        expect(moveFocus(document.createElement('div'), 'up')).toBe(false);
    });
});

describe('the D-pad', () => {
    it('happyPath_fromTheMapItMovesFromTheMiddle', () => {
        const s = stage();
        const { canvas } = layout(s);
        canvas.focus();

        navigate(s.viewer, 'down');

        expect(activeId(s)).toBe('slider');
    });

    it('happyPath_theTimelineKeepsLeftAndRightAndLetsUpAndDownLeave', () => {
        const s = stage();
        const { slider } = layout(s);
        const keys: string[] = [];
        slider.addEventListener('keydown', (event) => {
            keys.push(event.key);
            event.preventDefault();
        });
        slider.focus();

        navigate(s.viewer, 'right');
        navigate(s.viewer, 'left');
        expect(keys).toEqual(['ArrowRight', 'ArrowLeft']);
        expect(activeId(s)).toBe('slider');

        navigate(s.viewer, 'up');
        expect(keys).toHaveLength(2);
        expect(activeId(s)).not.toBe('slider');
    });

    it('edge_aVerticalSliderKeepsUpAndDown', () => {
        const s = stage();
        const { slider } = layout(s);
        slider.setAttribute('aria-orientation', 'vertical');
        const keys: string[] = [];
        slider.addEventListener('keydown', (event) => {
            keys.push(event.key);
        });
        slider.focus();

        navigate(s.viewer, 'up');

        expect(keys).toEqual(['ArrowUp']);
    });

    it('edge_withNothingFocusedItStartsFromTheMiddle', () => {
        const s = stage();
        layout(s);

        navigate(s.viewer, 'up');

        expect(['first', 'second', 'menu']).toContain(activeId(s));
    });
});

describe('A and the Xbox key emulation', () => {
    it('happyPath_aClicksWhatHasTheFocus', () => {
        const s = stage();
        const { first } = layout(s);
        const click = vi.fn();
        first.addEventListener('click', click);
        first.focus();

        activate(s.viewer);

        expect(click).toHaveBeenCalledOnce();
    });

    it('happyPath_aOnTheMapIsEnterAndACoveredMapTakesNone', () => {
        const s = stage();
        const { canvas } = layout(s);
        const keys: string[] = [];
        canvas.addEventListener('keydown', (event) => {
            keys.push(event.key);
        });

        activate(s.viewer);
        expect(keys).toEqual(['Enter']);
        expect(activeId(s)).toBe('canvas');

        s.covered = true;
        (document.activeElement as HTMLElement | null)?.blur();
        activate(s.viewer);
        expect(keys).toEqual(['Enter']);
    });

    it('happyPath_theEmulatedButtonsActLikeThePads', () => {
        const s = stage();
        const { first } = layout(s);
        const click = vi.fn();
        first.addEventListener('click', click);
        first.focus();

        expect(press(s, first, 'GamepadDPadRight').defaultPrevented).toBe(true);
        expect(activeId(s)).toBe('second');
        press(s, s.root.activeElement ?? first, 'GamepadDPadLeft');
        press(s, first, 'GamepadA');
        press(s, first, 'GamepadB');
        press(s, first, 'GamepadY');
        press(s, first, 'GamepadView');

        expect(click).toHaveBeenCalledOnce();
        expect(s.commands).toEqual(['close', 'layers', 'help']);
    });

    it('badPath_anotherGamepadKeyOrOneFromAnotherViewerIsLeftAlone', () => {
        const s = stage();
        const { first } = layout(s);
        first.focus();
        expect(press(s, first, 'GamepadLeftThumbstickUp').defaultPrevented).toBe(false);

        const other = document.createElement('button');
        document.body.append(other);
        other.focus();
        expect(press(s, other, 'GamepadB').defaultPrevented).toBe(false);
        expect(s.commands).toEqual([]);
    });

    it('happyPath_onlyAnXboxEdgeIsAskedForKeys', () => {
        const legacy = { gamepadInputEmulation: 'mouse' } as unknown as Navigator;
        const chromium = {} as Navigator;

        askForPadKeys(legacy);
        askForPadKeys(chromium);

        expect((legacy as unknown as { gamepadInputEmulation: string }).gamepadInputEmulation).toBe('keyboard');
        expect('gamepadInputEmulation' in chromium).toBe(false);
    });
});

describe('isGameConsole', () => {
    it('happyPath_theXboxAndThePlayStationAreConsoles', () => {
        expect(isGameConsole('Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 Edg/131.0')).toBe(true);
        expect(isGameConsole('Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 Version/13.0 Safari/605.1.15')).toBe(true);
    });

    it('badPath_aDesktopOrAPhoneIsNot', () => {
        expect(isGameConsole('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36')).toBe(false);
        expect(isGameConsole('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(false);
    });
});
