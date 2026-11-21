// The places page's Export all when the places cannot be read, and the place's photos: the picker's pages and failures, and a
// linked photo named from its own read.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { area, draft, editor, poisPage, poisState, ready } from './fixtures.js';

function press(element: HTMLElement): void {
    deep(element, 'button').click();
}

describe('<hcm-pois-page>: Export all and the photos', () => {
    beforeAll(defineAll);
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('badPath_anExportWhosePlacesCouldNotBeReadSavesNothingAndItsButtonWaitsWhileItReads @S-A34-BAD-EXPORT-ALL-UNREAD', async () => {
        const store = area(poisState(), { exportPlaces: Promise.resolve(null) });
        const { element } = await poisPage(store);
        const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);

        press(deep(element, 'hcm-button.export'));
        await updated(element);
        expect(store.named('exportPlaces')).toEqual(['exportPlaces false']);
        expect(clicked).not.toHaveBeenCalled();

        store.set({ exporting: true });
        await updated(element);
        expect(deep(element, 'hcm-button.export').hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_thePickerOffersThePhotosPastItsPage @S-A32-HAPPY-PHOTO-PICKER-PAGES', async () => {
        const photos = ready([{ id: 'p1', title: { ro: 'Lipscani' }, year: 1930, thumb: null }], { hasMore: true });
        const store = area(poisState({ editor: editor(), photos }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });
        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-pick-photos'));
        await updated(element);

        press(deep(deep(element, '.photo-picker'), 'hcm-button.more-photos'));

        expect(store.named('morePhotos')).toEqual(['morePhotos']);
        store.set({ photos: ready([]) });
        await updated(element);
        expect(deepAll(deep(element, '.photo-picker'), 'hcm-button.more-photos')).toEqual([]);
        expect(deepText(deep(element, '.photo-picker'))).toContain('The city has no photo yet.');
    });

    it('badPath_aPickerStillReadingOrFailedDoesNotSayTheCityHasNoPhoto', async () => {
        const store = area(poisState({ editor: editor(), photos: null }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });
        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-pick-photos'));
        await updated(element);
        expect(deepText(deep(element, '.photo-picker'))).not.toContain('The city has no photo yet.');

        store.set({ photos: ready([], { status: 'error', failure: { kind: 'failed', code: 'internal' } }) });
        await updated(element);
        expect(deepText(deep(element, '.photo-picker'))).not.toContain('The city has no photo yet.');
        press(deep(deep(element, '.photo-picker'), '.actions hcm-button'));

        expect(store.named('retry')).toEqual(['retry']);
    });

    it('happyPath_aLinkedPhotoIsNamedByItsOwnReadBeforeThePickerOpens @S-A32-BAD-LINKED-PHOTO-PAST-PAGE', async () => {
        const value = { ...draft().value, photoIds: ['p1', 'gone'] };
        const linkedPhotos = [{ id: 'p1', title: { ro: 'Lipscani' }, year: 1930, thumb: null }];
        const store = area(poisState({ editor: editor({ draft: draft({ value }) }), linkedPhotos }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });

        const chosen = deepAll(element, '.chosen li').map((row) => row.textContent);
        expect(chosen[0]).toContain('Lipscani');
        expect(chosen[1]).toContain('gone');
    });
});
