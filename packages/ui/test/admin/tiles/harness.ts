/** The tile-import wizard's browser-test harness: the page mounted on a fake area, its steps settled, its buttons and keys. */
import { html } from 'lit';

import { AREA_ELEMENTS } from '../../../src/admin/areas/help.js';
import type { TilesIntentsPort, TilesViewState } from '../../../src/admin/tiles/tiles-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, deep, deepAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

/** `<hcm-tiles-page>` on a fake area holding `view`, `width` pixels wide. */
export async function page(view: TilesViewState, width = 1200) {
    const area = new FakeArea<TilesViewState, TilesIntentsPort>(view, { preview: Promise.resolve(), handOff: Promise.resolve() });
    const app = new FakeAdminApp(adminState({ route: { id: 'help', params: [view.versionId, 'tiles'] } }));
    app.areas.help = area;
    AREA_ELEMENTS.define(customElements);
    const host = await mount<HTMLElement>(html`<hcm-tiles-page .app=${app} .state=${app.state}></hcm-tiles-page>`, width);
    await updated(host);
    return { host, area };
}

/** The page and its three steps' elements updated. */
export async function settled(host: HTMLElement): Promise<void> {
    await updated(host);
    for (const element of deepAll(host, 'hcm-tile-grid, hcm-seam-pair, hcm-tile-preview')) {
        await updated(element);
    }
}

/** The inner button of the `<hcm-button>` whose text has `label`. */
export function button(host: HTMLElement, label: string): HTMLButtonElement {
    const found = deepAll(host, 'hcm-button').find((item) => item.textContent.includes(label));
    if (found === undefined) {
        throw new Error(`no ${label}`);
    }
    return deep(found, 'button') as HTMLButtonElement;
}

/** A key pressed on `target`. */
export function key(target: HTMLElement, name: string, shiftKey = false): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, composed: true }));
}
