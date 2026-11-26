import type { Page } from '@playwright/test';

/**
 * A fake pad behind the browser's Gamepad API (behaviour V37; no real hardware in the tests): `navigator.getGamepads`
 * answers the page's `__hcmPads`, and connecting one fires `gamepadconnected` as the browser does.
 */
interface FakePad {
    mapping: string;
    axes: number[];
    buttons: { pressed: boolean; touched: boolean; value: number }[];
    index: number;
    id: string;
    connected: boolean;
}

interface PadWindow {
    __hcmPads: FakePad[];
}

export async function installFakePads(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const win = window as unknown as PadWindow;
        win.__hcmPads = [];
        navigator.getGamepads = () => win.__hcmPads as unknown as Gamepad[];
    });
}

/** Connects a pad of `mapping` ('standard', or '' for one without the standard layout). */
export async function connectPad(page: Page, mapping: 'standard' | '' = 'standard'): Promise<void> {
    await page.evaluate((padMapping) => {
        const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
        const pad = { mapping: padMapping, axes: [0, 0, 0, 0], buttons, index: 0, id: 'fake pad', connected: true };
        (window as unknown as PadWindow).__hcmPads.push(pad);
        window.dispatchEvent(new Event('gamepadconnected'));
    }, mapping);
}

export async function setAxis(page: Page, axis: number, value: number): Promise<void> {
    await page.evaluate(
        ({ index, tilt }) => {
            const pad = (window as unknown as PadWindow).__hcmPads[0];
            if (pad !== undefined) {
                pad.axes[index] = tilt;
            }
        },
        { index: axis, tilt: value },
    );
}

export async function holdButton(page: Page, button: number, value: number): Promise<void> {
    await page.evaluate(
        ({ index, pressure }) => {
            const held = (window as unknown as PadWindow).__hcmPads[0]?.buttons[index];
            if (held !== undefined) {
                held.pressed = pressure > 0;
                held.value = pressure;
            }
        },
        { index: button, pressure: value },
    );
}

/** A frame for the page's loop to read, in the page's own time: a double animation frame. */
export async function nextFrames(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(resolve);
                });
            }),
    );
}

/** Presses and releases a button, each held for the loop to see. */
export async function pressButton(page: Page, button: number): Promise<void> {
    await holdButton(page, button, 1);
    await nextFrames(page);
    await holdButton(page, button, 0);
    await nextFrames(page);
}

/** Hides or shows the tab as the page sees it. */
export async function setTabHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((isHidden) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

/** Unplugs the pad: it leaves `getGamepads` and the page hears `gamepaddisconnected`, as the browser does. */
export async function disconnectPad(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as PadWindow).__hcmPads.length = 0;
        window.dispatchEvent(new Event('gamepaddisconnected'));
    });
}

/** Counts the page's reads of the pads (`__hcmPadReads`): a loop that stopped reads no more. Install after the fake pads. */
export async function countPadReads(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const counted = window as unknown as { __hcmPadReads: number };
        const read = navigator.getGamepads.bind(navigator);
        counted.__hcmPadReads = 0;
        navigator.getGamepads = () => {
            counted.__hcmPadReads += 1;
            return read();
        };
    });
}

export async function padReads(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { __hcmPadReads: number }).__hcmPadReads);
}
