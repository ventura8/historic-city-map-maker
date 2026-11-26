/** V91: the star (`<hcm-favorite-star>`), the Favourites list (`<hcm-favorites>`) and its sheet (`viewer-favorites.ts`). */
import { translate } from '@hcm/shared';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { favorites } from '../../src/viewer/favorites.js';
import { HCM_FAVORITE_STAR_TAG, defineHcmFavoriteStar, type HcmFavoriteStar } from '../../src/viewer/hcm-favorite-star.js';
import { HCM_FAVORITES_TAG, defineHcmFavorites, favoriteOpenEvent, type HcmFavorites } from '../../src/viewer/hcm-favorites.js';
import { menuAction } from '../../src/viewer/viewer-actions.js';
import { favoritesSheet, type FavoritesHandlers } from '../../src/viewer/viewer-favorites.js';
import { menuActions, menuItem } from '../../src/viewer/viewer-menu.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { fakeServices } from './viewer-harness.js';

let city = 0;

/** A fresh, empty list: the store is the page's one, so each test loads a city of its own. */
function freshCity(): void {
    city += 1;
    favorites.load(`test-${String(city)}`);
}

beforeAll(() => {
    defineKitDoubles();
    defineHcmFavoriteStar();
    defineHcmFavorites();
});

afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    // Only this file's keys: other test files share the page's storage.
    for (const key of Object.keys(localStorage).filter((name) => name.endsWith(':favorites'))) {
        localStorage.removeItem(key);
    }
});

describe('<hcm-favorite-star> @S-V91-HAPPY-STAR', () => {
    it('happyPath_aPressSavesThenRemovesAndEveryStarAgrees', async () => {
        freshCity();
        const star = await mountElement<HcmFavoriteStar>(HCM_FAVORITE_STAR_TAG, { kind: 'poi', itemId: 'casa-uranus', locale: 'en' });
        const twin = await mountElement<HcmFavoriteStar>(HCM_FAVORITE_STAR_TAG, { kind: 'poi', itemId: 'casa-uranus', locale: 'en' });
        const button = (element: HcmFavoriteStar) =>
            shadowQuery(element, 'hcm-icon-button') as HTMLElement & { selected: boolean; label: string };
        expect(button(star).selected).toBe(false);
        expect(button(star).label).toBe(translate('en', 'favorites.add'));
        button(star).click();
        await twin.updateComplete;
        expect(favorites.has('poi', 'casa-uranus')).toBe(true);
        expect(button(twin).selected).toBe(true);
        expect(button(twin).label).toBe(translate('en', 'favorites.remove'));
        button(twin).click();
        await star.updateComplete;
        expect(button(star).selected).toBe(false);
        star.remove();
        favorites.toggle('poi', 'casa-uranus');
        expect(favorites.has('poi', 'casa-uranus')).toBe(true);
    });
});

describe('<hcm-favorites> @S-V91-HAPPY-LIST', () => {
    it('happyPath_eachRowOpensItsItemWithTheViewersEvent', async () => {
        freshCity();
        favorites.toggle('story', 'gone');
        favorites.toggle('layer', 'kh9-1977');
        favorites.toggle('photo', 'mihai-voda-1978');
        favorites.toggle('poi', 'casa-uranus');
        const list = await mountElement<HcmFavorites>(HCM_FAVORITES_TAG, { manifest: testManifest(), locale: 'en' });
        const events = recordEvents(list, 'hcm-poi-select', 'hcm-photo-select', 'hcm-layer-show');
        const rows = shadowQueryAll(list, 'button.open');
        expect(rows.map((row) => row.dataset['open'])).toEqual(['poi:casa-uranus', 'photo:mihai-voda-1978', 'layer:kh9-1977']);
        for (const row of rows) {
            row.click();
        }
        expect(events).toEqual([
            { type: 'hcm-poi-select', detail: { poiId: 'casa-uranus' } },
            { type: 'hcm-photo-select', detail: { photoId: 'mihai-voda-1978' } },
            { type: 'hcm-layer-show', detail: { layerId: 'kh9-1977' } },
        ]);
        expect(favoriteOpenEvent({ kind: 'story', id: 's' }).detail).toEqual({ storyId: 's' });
        favorites.toggle('poi', 'casa-uranus');
        await list.updateComplete;
        expect(shadowQueryAll(list, 'button.open')).toHaveLength(2);
        list.remove();
        favorites.toggle('poi', 'casa-uranus');
    });

    it('badInput_noneSaysHowToSaveOne @S-V91-BAD-EMPTY', async () => {
        freshCity();
        const list = await mountElement<HcmFavorites>(HCM_FAVORITES_TAG, { locale: 'en' });
        expect(shadowText(list)).toBe(translate('en', 'favorites.empty'));
    });

    it('badInput_blockedStorageSaysTheListLastsThePageOnly @S-V91-BAD-STORAGE', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });
        freshCity();
        favorites.toggle('poi', 'casa-uranus');
        const list = await mountElement<HcmFavorites>(HCM_FAVORITES_TAG, { manifest: testManifest(), locale: 'en' });
        expect(shadowQuery(list, '[data-favorites="not-saved"]').textContent).toContain(translate('en', 'favorites.notSavedFix'));
        expect(shadowQueryAll(list, 'button.open')).toHaveLength(1);
    });
});

describe('the Favourites sheet and menu', () => {
    it('happyPath_theMenuOpensTheSheetWhichClosesWhenALayerShows', () => {
        const manifest = testManifest();
        expect(menuActions({ webgl: true, layersDocked: false, manifest })).toContain('favorites');
        expect(menuItem('favorites', 'en')).toEqual({ value: 'favorites', icon: 'star', label: translate('en', 'favorites.title') });
        const store = new FakeStore(readyState());
        menuAction(store, fakeServices(), 'favorites');
        expect(store.getState().sheet).toBe('favorites');

        const seen: string[] = [];
        const record = (event: Event): void => {
            seen.push(event.type);
        };
        const handlers: FavoritesHandlers = {
            onSheetClose: record,
            onStorySelect: record,
            onPhotoSelect: record,
            onPoiSelect: record,
            onLayerShow: record,
        };
        const host = document.createElement('div');
        document.body.append(host);
        render(favoritesSheet('en', manifest, { mode: 'docked', open: true }, handlers), host);
        expect(host.querySelector('h2')?.textContent).toBe(translate('en', 'favorites.title'));
        const sheet = host.querySelector('.favorites-sheet');
        sheet?.dispatchEvent(favoriteOpenEvent({ kind: 'layer', id: 'kh9-1977' }));
        sheet?.dispatchEvent(favoriteOpenEvent({ kind: 'story', id: 's' }));
        host.querySelector('hcm-icon-button')?.dispatchEvent(new Event('click'));
        render(favoritesSheet('ro', manifest, { mode: 'bottom', open: false, inert: true }, handlers), host);
        expect(host.querySelector('.favorites-sheet')?.hasAttribute('inert')).toBe(true);
        expect(seen).toEqual(['hcm-layer-show', 'hcm-close', 'hcm-story-select', 'hcm-close']);
    });
});
