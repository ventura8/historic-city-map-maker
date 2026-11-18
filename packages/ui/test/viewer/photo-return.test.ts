import { describe, expect, it } from 'vitest';

import { PhotoReturn, type ReturnWindow } from '../../src/viewer/photo-return.js';
import type { ViewerStorePort } from '../../src/viewer/store-port.js';
import { FakeStore, readyState } from './fake-store.js';

type Listener = () => void;

/** A page whose history is a list of entries and whose events a test fires. */
class FakeWindow implements ReturnWindow {
    readonly entries: unknown[] = [null];
    readonly listeners = new Map<string, Set<Listener>>();
    readonly location = { href: 'https://map.test/#y=1978' };
    backs = 0;
    readonly history = {
        get state(): unknown {
            return this.owner.entries.at(-1);
        },
        owner: this as FakeWindow,
        pushState: (data: unknown): void => {
            this.entries.push(data);
        },
        back: (): void => {
            this.backs += 1;
            this.entries.pop();
            this.fire('popstate');
        },
    };

    addEventListener(type: string, listener: Listener): void {
        const set = this.listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    fire(type: string): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener();
        }
    }
}

function setup(sheet: 'photos' | 'none' = 'photos'): { win: FakeWindow; store: FakeStore; back: PhotoReturn } {
    const win = new FakeWindow();
    const store = new FakeStore(readyState(undefined, { sheet }));
    const back = new PhotoReturn(win, (action: (store: ViewerStorePort) => void) => {
        action(store);
    });
    return { win, store, back };
}

function openFromList(store: FakeStore, back: PhotoReturn, scroll = 240): void {
    back.opened(store.getState().sheet, scroll);
    store.openPhoto('mihai-voda-1978');
}

describe('PhotoReturn', () => {
    it('happyPath_backButtonPopsTheEntryAndReopensTheListAtItsScroll', () => {
        const { win, store, back } = setup();
        openFromList(store, back);
        expect(win.entries).toHaveLength(2);
        expect(back.fromList).toBe(true);

        expect(back.back(store)).toBe(true);

        expect(win.backs).toBe(1);
        expect(store.getState().sheet).toBe('photos');
        expect(back.fromList).toBe(false);
        expect(back.scroll).toBe(240);
    });

    it('happyPath_backGestureReopensTheListAndAgainAfterTheHashApplies', () => {
        const { win, store, back } = setup();
        openFromList(store, back);

        win.entries.pop();
        win.fire('popstate');
        expect(store.getState().sheet).toBe('photos');
        store.set({ sheet: 'none', selectedPhotoId: null });
        win.fire('hashchange');

        expect(store.getState().sheet).toBe('photos');
    });

    it('happyPath_anotherPhotoFromThePhotoKeepsTheWayBack', () => {
        const { win, store, back } = setup();
        openFromList(store, back);
        back.opened('photo', 0);

        expect(back.fromList).toBe(true);
        expect(win.entries).toHaveLength(2);
    });

    it('happyPath_withoutTheHistoryEntryBackStillReturns', () => {
        const { win, store, back } = setup();
        openFromList(store, back);
        win.entries.pop();

        expect(back.back(store)).toBe(true);
        expect(win.backs).toBe(0);
        expect(store.getState().sheet).toBe('photos');
    });

    it('badPath_aPhotoFromTheMapClosesAsBefore', () => {
        const { win, store, back } = setup('none');
        back.opened('none', 0);
        store.openPhoto('mihai-voda-1978');

        expect(back.back(store)).toBe(false);
        expect(win.entries).toHaveLength(1);
        win.fire('popstate');
        expect(store.getState().sheet).toBe('photo');
    });

    it('badPath_aStaleEntryOrHashDoesNotReopenTheList', () => {
        const { win, store, back } = setup();
        openFromList(store, back);
        win.entries.pop();
        win.fire('popstate');
        store.set({ selectedPhotoId: 'mihai-voda-1978', sheet: 'photo' });
        win.fire('hashchange');
        expect(store.getState().sheet).toBe('photo');

        win.fire('popstate');
        expect(store.getState().sheet).toBe('photo');
        expect(back.back(store)).toBe(false);
    });
});
