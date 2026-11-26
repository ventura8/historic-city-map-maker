import type { Locator, Page } from '@playwright/test';

/**
 * The admin-input budget (docs/research/design-review-testability.md §4.3, PLAN "minimum admin input"): a flow
 * declares how many human inputs it may take, every fill, click, paste and file choice goes through the flow, and the
 * test fails at teardown when a flow used more than its budget. Used by the admin tiers from M2, for example the Mapbox
 * setup (at most 2 inputs) or importing a free scene (at most 2 clicks).
 */

export interface InputFlow {
    readonly name: string;
    readonly limit: number;
    readonly used: number;
    fill(locator: Locator, value: string): Promise<void>;
    click(locator: Locator): Promise<void>;
    /** A paste from the clipboard (Ctrl+V): the field sees a `paste` event and an `insertFromPaste` input, as from a human. */
    paste(locator: Locator, value: string): Promise<void>;
    setInputFiles(locator: Locator, files: string | readonly string[]): Promise<void>;
    /** A click at a point of the page (a place on the admin map). */
    clickAt(page: Page, point: { readonly x: number; readonly y: number }): Promise<void>;
    /** One drag from a point of the page to another, the button held (M5: the New city's rectangle on the map). */
    drag(page: Page, from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }): Promise<void>;
    /** A key that commits (Enter on a button, a slider's step). */
    press(locator: Locator, key: string): Promise<void>;
    /** An option chosen in a select. */
    selectOption(locator: Locator, value: string): Promise<void>;
}

/** Puts `value` on the browser's clipboard and pastes it into `locator` with the keyboard. */
async function pasteInto(locator: Locator, value: string): Promise<void> {
    const page = locator.page();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate((text) => navigator.clipboard.writeText(text), value);
    await locator.focus();
    await locator.press('ControlOrMeta+V');
}

export class InputBudget {
    readonly #flows: InputFlow[] = [];

    /** A new counted flow of at most `limit` inputs. */
    flow(name: string, limit: number): InputFlow {
        let used = 0;
        const count = (): void => {
            used += 1;
        };
        const flow: InputFlow = {
            name,
            limit,
            get used() {
                return used;
            },
            fill: async (locator, value) => {
                count();
                await locator.fill(value);
            },
            click: async (locator) => {
                count();
                await locator.click();
            },
            paste: async (locator, value) => {
                count();
                await pasteInto(locator, value);
            },
            setInputFiles: async (locator, files) => {
                count();
                await locator.setInputFiles(typeof files === 'string' ? files : [...files]);
            },
            clickAt: async (page, point) => {
                count();
                await page.mouse.click(point.x, point.y);
            },
            drag: async (page, from, to) => {
                count();
                await page.mouse.move(from.x, from.y);
                await page.mouse.down();
                await page.mouse.move(to.x, to.y, { steps: 8 });
                await page.mouse.up();
            },
            press: async (locator, key) => {
                count();
                await locator.press(key);
            },
            selectOption: async (locator, value) => {
                count();
                await locator.selectOption(value);
            },
        };
        this.#flows.push(flow);
        return flow;
    }

    /** `name: used/limit` for every flow over its budget. */
    overruns(): string[] {
        return this.#flows
            .filter((flow) => flow.used > flow.limit)
            .map((flow) => `${flow.name}: ${String(flow.used)}/${String(flow.limit)}`);
    }
}
