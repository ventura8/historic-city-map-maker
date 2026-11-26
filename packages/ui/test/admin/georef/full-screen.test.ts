import { afterEach, describe, expect, it, vi } from 'vitest';

import { enterScreen, FullScreenInert, leaveScreen, screenElement, surroundings } from '../../../src/admin/georef/full-screen.js';

afterEach(() => {
    document.body.replaceChildren();
});

describe('full screen (M22 §13.2)', () => {
    it('happyPath_everythingAroundThePageAcrossShadowRootsIsInertThenGivenBack', () => {
        const nav = document.createElement('nav');
        const shell = document.createElement('div');
        document.body.append(nav, shell);
        const root = shell.attachShadow({ mode: 'open' });
        const bar = document.createElement('header');
        const page = document.createElement('section');
        root.append(bar, page);
        const inert = new FullScreenInert();

        inert.cover(page, true);
        const made = [nav.inert, bar.inert, page.inert];
        inert.cover(page, false);

        expect(made).toEqual([true, true, false]);
        expect([nav.inert, bar.inert]).toEqual([false, false]);
    });

    it('badPath_whatWasAlreadyInertStaysInert', () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('inert', '');
        const page = document.createElement('section');
        document.body.append(dialog, page);
        const inert = new FullScreenInert();

        inert.cover(page, true);
        inert.cover(page, false);

        expect(dialog.inert).toBe(true);
        expect(surroundings(document.createElement('p'))).toEqual([]);
    });
});

describe('the browser full screen (the owner, 2026-11-16)', () => {
    it('happyPath_theStandardApiShowsTheElementAndLeaves', async () => {
        const element = document.createElement('section');
        const request = vi.fn(() => Promise.resolve());
        Object.assign(element, { requestFullscreen: request });
        const exit = vi.fn(() => Promise.resolve());
        const doc = { fullscreenElement: element, exitFullscreen: exit } as unknown as Document;

        const shown = await enterScreen(element);
        await leaveScreen(doc);

        expect(shown).toBe(true);
        expect(screenElement(doc)).toBe(element);
        expect(exit).toHaveBeenCalledOnce();
    });

    it('happyPath_safariPrefixedApi', async () => {
        const element = { webkitRequestFullscreen: vi.fn(() => Promise.resolve()) } as unknown as Element;
        const exit = vi.fn(() => Promise.resolve());
        const doc = { fullscreenElement: null, webkitFullscreenElement: element, webkitExitFullscreen: exit } as unknown as Document;

        expect(await enterScreen(element)).toBe(true);
        await leaveScreen(doc);

        expect(screenElement(doc)).toBe(element);
        expect(exit).toHaveBeenCalledOnce();
    });

    it('badPath_refusedOrMissingApiReturnsFalse', async () => {
        const refused = { requestFullscreen: () => Promise.reject(new TypeError('denied')) } as unknown as Element;
        const missing = {} as Element;
        const failing = { fullscreenElement: missing, exitFullscreen: () => Promise.reject(new TypeError('gone')) } as unknown as Document;
        const none = { fullscreenElement: null } as unknown as Document;

        expect(await enterScreen(refused)).toBe(false);
        expect(await enterScreen(missing)).toBe(false);
        await expect(leaveScreen(failing)).resolves.toBeUndefined();
        await expect(leaveScreen(none)).resolves.toBeUndefined();
        expect(screenElement(none)).toBeNull();
        expect(screenElement({ fullscreenElement: null, webkitExitFullscreen: undefined } as unknown as Document)).toBeNull();
    });

    it('badPath_noExitFunctionIsHarmless', async () => {
        const doc = { webkitFullscreenElement: document.body } as unknown as Document;

        await expect(leaveScreen(doc)).resolves.toBeUndefined();
    });
});
