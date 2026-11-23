/** The viewer's handlers over a fake host (`viewer-handlers.ts`): a story's links, and a photo that goes back to its list. */
import { describe, expect, it, vi } from 'vitest';

import type { PhotoReturn } from '../../src/viewer/photo-return.js';
import { createHandlers, type HandlerHost } from '../../src/viewer/viewer-handlers.js';
import { FakeStore, readyState } from './fake-store.js';

function host(store: FakeStore, photoReturn: Pick<PhotoReturn, 'back'>): HandlerHost {
    return {
        act: (_event, action) => {
            action(store);
        },
        setOpacity: vi.fn(),
        services: vi.fn(),
        focusTimeline: vi.fn(),
        closeDates: vi.fn(),
        mapMenu: vi.fn(),
        photoReturn: photoReturn as PhotoReturn,
    };
}

function detail<T>(value: T): CustomEvent<T> {
    return new CustomEvent('x', { detail: value });
}

describe('the viewer handlers', () => {
    it('happyPath_aStoryOpensAndItsPlaceToo_andAPhotoFromTheListGoesBackToIt', () => {
        const store = new FakeStore(readyState());
        const handlers = createHandlers(host(store, { back: () => true }));

        handlers.onStorySelect(detail({ storyId: 's1' }));
        handlers.onPoiSelect(detail({ poiId: 'p1' }));
        handlers.onSheetClose(new Event('close'));

        expect(store.calls.map((call) => call.method)).toEqual(['openStory', 'openPoi']);
    });

    it('badPath_aPhotoNotOpenedFromTheListClosesItsSheet', () => {
        const store = new FakeStore(readyState());
        const handlers = createHandlers(host(store, { back: () => false }));

        handlers.onSheetClose(new Event('close'));

        expect(store.calls.length).toBeGreaterThan(0);
    });
});
