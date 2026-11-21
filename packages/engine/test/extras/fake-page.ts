/** A page's `document` for the extras' loader in Node: the scripts it adds, which the test makes load or fail. */
import type { ExtraScript, ExtrasDocument } from '../../src/extras/loader.js';

export class FakeScript implements ExtraScript {
    src = '';
    integrity = '';
    crossOrigin: string | null = null;
    async = false;
    removed = false;
    readonly #listeners = new Map<string, () => void>();

    addEventListener(type: 'load' | 'error', listener: () => void): void {
        this.#listeners.set(type, listener);
    }

    remove(): void {
        this.removed = true;
    }

    /** The browser ran the script (`register` first, as the script's body does) or refused it. */
    fire(type: 'load' | 'error'): void {
        this.#listeners.get(type)?.();
    }
}

export class FakeDocument implements ExtrasDocument<FakeScript> {
    readonly scripts: FakeScript[] = [];
    readonly head = {
        append: (node: FakeScript): void => {
            this.scripts.push(node);
        },
    };

    createElement(): FakeScript {
        return new FakeScript();
    }
}

/** Lets the loader's promise callbacks run. */
export async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await Promise.resolve();
    }
}
