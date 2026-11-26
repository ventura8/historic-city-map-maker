/**
 * The viewer side-loads the full-size view when it first opens (`services.loadExtras`), and hands the version the visitor
 * picks to the store; a part that does not load closes the view and says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lightboxPhotos } from '../../src/viewer/viewer-lightbox.js';
import { fireKitEvent, shadowQuery } from './doubles.js';
import { idleState, readyState } from './fake-store.js';
import { fakeServices, mountViewer } from './viewer-harness.js';

const OPEN = { selectedPhotoId: 'uranus-1984', sheet: 'photo', lightbox: true } as const;

describe('the viewer and the full-size view', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_eachOpeningAsksForThePartAndAPickReachesTheStore', async () => {
        const { element, store } = await mountViewer(readyState());
        const loadExtras = vi.fn(() => Promise.resolve());
        element.services = fakeServices({ loadExtras });

        store.set(OPEN);
        store.set({ ...OPEN, lightbox: false });
        store.set(OPEN);
        await element.updateComplete;
        fireKitEvent(shadowQuery(element, 'hcm-lightbox'), 'hcm-photo-version', { view: 'improved' });

        expect(loadExtras).toHaveBeenCalledTimes(2);
        expect(store.getState().photoVersion).toBe('improved');
    });

    it('badPath_aPartThatDoesNotLoadClosesTheViewAndSaysSo', async () => {
        const { element, store } = await mountViewer(readyState());
        element.services = fakeServices({ loadExtras: () => Promise.reject(new Error('offline')) });

        store.set(OPEN);

        await vi.waitFor(() => {
            expect(store.getState()).toMatchObject({ lightbox: false, toast: { key: 'error.photoImage' } });
        });
    });

    it('badPath_aboutThatDoesNotLoadClosesItsSheet', async () => {
        const { element, store } = await mountViewer(readyState());
        element.services = fakeServices({ loadExtras: () => Promise.reject(new Error('offline')) });

        store.set({ sheet: 'about' });

        await vi.waitFor(() => {
            expect(store.getState().sheet).toBe('none');
        });
    });

    it('happyPath_aRightClickOnTheMapOpensItsMenuWhichCopiesAndCloses', async () => {
        const { element, store } = await mountViewer(readyState());
        const copied: string[] = [];
        element.services = fakeServices({
            copyText: (text) => {
                copied.push(text);
                return Promise.resolve();
            },
        });
        const map = element.mapContainer ?? element;

        map.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
        await vi.waitFor(() => {
            expect(element.mapMenu).not.toBeNull();
        });
        await element.updateComplete;
        const menu = shadowQuery(element, 'hcm-map-menu');
        fireKitEvent(menu, 'hcm-map-menu-copy', { text: '44.4, 26.1' });
        fireKitEvent(menu, 'hcm-close');

        await vi.waitFor(() => {
            expect(store.getState().toast).toEqual({ key: 'mapMenu.copied' });
        });
        expect(copied).toEqual(['44.4, 26.1']);
        expect(element.mapMenu).toBeNull();
    });

    /** The viewer with the map's menu open from a right click. */
    async function withOpenMenu(services: Parameters<typeof fakeServices>[0]) {
        const mounted = await mountViewer(readyState());
        mounted.element.services = fakeServices(services);
        const map = mounted.element.mapContainer ?? mounted.element;
        map.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
        await vi.waitFor(() => {
            expect(mounted.element.mapMenu).not.toBeNull();
        });
        await mounted.element.updateComplete;
        return { ...mounted, menu: shadowQuery(mounted.element, 'hcm-map-menu') };
    }

    it('happyPath_theMenusShareCopiesThePagesAddressAndSaysSo', async () => {
        const copied: string[] = [];
        const { element, store, menu } = await withOpenMenu({
            share: null,
            pageUrl: () => 'https://example.org/#16/44.4/26.1',
            copyText: (text) => {
                copied.push(text);
                return Promise.resolve();
            },
        });
        const left: string[] = [];
        element.addEventListener('hcm-map-menu-share', (event) => left.push(event.type));

        fireKitEvent(menu, 'hcm-map-menu-share');

        await vi.waitFor(() => {
            expect(store.getState().toast).toEqual({ key: 'share.copied' });
        });
        expect(copied).toEqual(['https://example.org/#16/44.4/26.1']);
        expect(left, 'the event stays inside the viewer').toEqual([]);
    });

    it('badPath_aClipboardThatRefusesSaysTheCoordinatesWereNotCopiedAndTheLinkNeither', async () => {
        const { store, menu } = await withOpenMenu({ share: null, copyText: () => Promise.reject(new Error('denied')) });

        fireKitEvent(menu, 'hcm-map-menu-copy', { text: '44.4, 26.1' });
        await vi.waitFor(() => {
            expect(store.getState().toast).toEqual({ key: 'mapMenu.copyFailed' });
        });
        fireKitEvent(menu, 'hcm-map-menu-share');

        await vi.waitFor(() => {
            expect(store.getState().toast).toEqual({ key: 'share.failed' });
        });
    });

    it('badPath_beforeTheMapIsReadyNoMenuOpens', async () => {
        const { element } = await mountViewer(idleState());

        (element.mapContainer ?? element).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await element.updateComplete;

        expect(element.mapMenu).toBeNull();
    });
});

describe('lightboxPhotos', () => {
    const PHOTOS = [
        { id: 'a', year: 1935 },
        { id: 'b', year: 1941 },
        { id: 'c', year: 1980 },
        { id: 'd', year: undefined },
    ];

    it('happyPath_itCountsTheListItWasOpenedFromThePhotosNearTheYearOrAllAtToday', () => {
        expect(lightboxPhotos(PHOTOS, 1939, 'b').map((photo) => photo.id)).toEqual(['a', 'b']);
        expect(lightboxPhotos(PHOTOS, null, 'c')).toBe(PHOTOS);
    });

    it('badPath_aPhotoFarFromTheYearPagesThroughAllOfThem', () => {
        expect(lightboxPhotos(PHOTOS, 1939, 'c')).toBe(PHOTOS);
        expect(lightboxPhotos(PHOTOS, 1939, null)).toBe(PHOTOS);
    });
});
