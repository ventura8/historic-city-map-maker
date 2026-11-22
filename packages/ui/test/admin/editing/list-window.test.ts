import { html, render, type TemplateResult } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineEditingElements } from '../../../src/admin/editing/define.js';
import { HcmListWindow, LIST_WINDOW_STEP } from '../../../src/admin/editing/hcm-list-window.js';
import { countLine, listBody, listWindow } from '../../../src/admin/editing/states.js';

const hosts: HTMLElement[] = [];

function names(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `place ${String(index)}`);
}

const rows = (items: readonly string[]): TemplateResult =>
    html`<ul>
        ${items.map((item) => html`<li>${item}</li>`)}
    </ul>`;

/** A host of `height` CSS px that scrolls, holding the template; resolves once Lit and the observer settled. */
async function mount(template: TemplateResult, height = 400): Promise<HTMLElement> {
    const host = document.createElement('div');
    host.style.blockSize = `${String(height)}px`;
    host.style.overflow = 'auto';
    document.body.append(host);
    hosts.push(host);
    render(template, host);
    await settle(host);
    return host;
}

async function settle(host: HTMLElement): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await host.querySelector<HcmListWindow>('hcm-list-window')?.updateComplete;
    }
}

function windowOf(host: HTMLElement): HcmListWindow {
    const element = host.querySelector<HcmListWindow>('hcm-list-window');
    if (element === null) {
        throw new Error('no hcm-list-window');
    }
    return element;
}

beforeAll(() => {
    defineEditingElements();
});

afterEach(() => {
    for (const host of hosts.splice(0)) {
        host.remove();
    }
});

describe('hcm-list-window', () => {
    it('happyPath_aLongListDrawsOneWindowThenTheNextAsTheEndScrollsIntoView', async () => {
        const host = await mount(listWindow('ro', names(315), false, { items: rows }));

        expect(host.querySelectorAll('li')).toHaveLength(LIST_WINDOW_STEP);
        host.scrollTop = host.scrollHeight;
        await settle(host);

        expect(host.querySelectorAll('li')).toHaveLength(315);
        expect(host.querySelector('.list-end')).toBeNull();
    });

    it('happyPath_onceEveryReadRowIsDrawnTheEndAsksForTheNextDocuments', async () => {
        let asked = 0;
        const more = (): void => {
            asked += 1;
        };
        const host = await mount(listWindow('en', names(3), true, { more, items: rows }));

        expect(asked).toBeGreaterThan(0);
        expect(host.querySelector('.list-end')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('badPath_withoutTheObserverTheFallbackButtonStepsAndNothingMoreIsAskedWithoutAReader', async () => {
        const element = new HcmListWindow();
        element.items = names(5);
        element.step = 2;
        element.shown = 2;
        element.advance();
        expect(element.shown).toBe(4);
        element.advance();
        element.advance();
        expect(element.pending).toBe(false);
        element.hasMore = true;
        element.advance();
        expect(element.pending).toBe(true);

        const observer = globalThis.IntersectionObserver;
        Reflect.deleteProperty(globalThis, 'IntersectionObserver');
        try {
            const host = await mount(listWindow('en', names(250), false, { items: rows }));
            expect(host.querySelector('.list-end hcm-button')?.textContent.trim()).toBe('Show more');
            host.querySelector<HTMLElement>('.list-end hcm-button')?.click();
            await settle(host);
            expect(windowOf(host).shown).toBe(2 * LIST_WINDOW_STEP);
            expect(host.querySelectorAll('li')).toHaveLength(250);
        } finally {
            globalThis.IntersectionObserver = observer;
        }
    });
});

describe('listBody', () => {
    const ready = { status: 'ready' as const, reconnecting: false, failure: null };

    it('happyPath_countsEveryItemTheSearchKeeps', async () => {
        const handlers = {
            retry: () => undefined,
            more: () => undefined,
            items: rows,
            shown: (items: readonly string[]) => items.slice(1),
        };
        const host = await mount(
            listBody(
                'ro',
                { ...ready, items: names(316), hasMore: false },
                { empty: 'adminContent.pois.empty', icon: 'place', count: 'adminContent.pois.count' },
                handlers,
            ),
        );

        expect(host.querySelector('.list-count')?.textContent.trim()).toBe('Locuri: 315');
    });

    it('badPath_aCountPastWhatWasReadSaysThereAreMore', async () => {
        const host = await mount(countLine('en', 2000, true));

        expect(host.querySelector('.list-count')?.textContent.trim()).toBe('In the list: 2000+');
    });
});
