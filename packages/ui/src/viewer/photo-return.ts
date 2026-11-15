/**
 * Back to the photo list (V75): a photo opened from the "Photos" list returns to that list, at the row the visitor
 * scrolled to, by the photo sheet's Back button, its close or Esc, and the browser's or the phone's back gesture (iOS
 * swipe-back). Opening such a photo pushes one history entry; the back gesture pops it (`popstate`). A photo opened from
 * the map is not marked and closes as before.
 */
import type { SheetName, ViewerStorePort } from './store-port.js';

/** The history entry's mark: a photo was opened from the list. */
const MARK = 'hcmPhotoFromList';

/** What the return needs of the page. */
export interface ReturnWindow {
    readonly history: { readonly state: unknown; pushState(data: unknown, unused: string, url?: string | null): void; back(): void };
    readonly location: { readonly href: string };
    addEventListener(type: 'popstate' | 'hashchange', listener: () => void, options?: { readonly once: boolean }): void;
    removeEventListener(type: 'popstate' | 'hashchange', listener: () => void): void;
}

function marked(state: unknown): boolean {
    return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true;
}

export class PhotoReturn {
    #fromList = false;
    #scroll = 0;
    readonly #win: ReturnWindow;
    readonly #act: (action: (store: ViewerStorePort) => void) => void;

    constructor(win: ReturnWindow, act: (action: (store: ViewerStorePort) => void) => void) {
        this.#win = win;
        this.#act = act;
    }

    /** The open photo came from the list: its sheet shows Back. */
    get fromList(): boolean {
        return this.#fromList;
    }

    /** Where the list was scrolled when a photo opened from it. */
    get scroll(): number {
        return this.#scroll;
    }

    connect(): void {
        this.#win.addEventListener('popstate', this.#onPop);
    }

    disconnect(): void {
        this.#win.removeEventListener('popstate', this.#onPop);
        this.#win.removeEventListener('hashchange', this.#reopen);
    }

    /** A photo opens while `sheet` shows: from the list it is marked (one history entry); another photo keeps the mark. */
    opened(sheet: SheetName, scroll: number): void {
        this.#win.removeEventListener('hashchange', this.#reopen);
        if (sheet === 'photos') {
            if (!marked(this.#win.history.state)) {
                this.#win.history.pushState({ [MARK]: true }, '', this.#win.location.href);
            }
            this.#fromList = true;
            this.#scroll = scroll;
        } else if (sheet !== 'photo') {
            this.#fromList = false;
            this.#scroll = 0;
        }
    }

    /** Back, the close or Esc of a photo from the list: true when it goes back to the list (else the caller closes). */
    back(store: ViewerStorePort): boolean {
        if (!this.#fromList || store.getState().sheet !== 'photo') {
            return false;
        }
        if (marked(this.#win.history.state)) {
            this.#win.history.back();
        } else {
            this.#toList(store);
        }
        return true;
    }

    #toList(store: ViewerStorePort): void {
        this.#fromList = false;
        store.openSheet('photos');
    }

    /** The back gesture: the list opens again, and once more after the hash the store applies (the photo's left it). */
    readonly #onPop = (): void => {
        this.#act((store) => {
            if (this.#fromList && store.getState().sheet === 'photo') {
                this.#toList(store);
                this.#win.addEventListener('hashchange', this.#reopen, { once: true });
            }
        });
    };

    readonly #reopen = (): void => {
        this.#act((store) => {
            if (store.getState().selectedPhotoId === null) {
                store.openSheet('photos');
            }
        });
    };
}
