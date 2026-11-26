/** `<hcm-stories>` and the `stories` sheet (M17, `docs/research/M17-stories.md` §5; V50): the list, a story, where it is found. */
import type { Manifest, Story, UnplacedPhoto } from '@hcm/shared';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_PHOTO_SHEET_TAG, defineHcmPhotoSheet, type HcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { defineHcmPoiDetail } from '../../src/viewer/hcm-poi-detail.js';
import { HCM_STORIES_TAG, defineHcmStories, type HcmStories } from '../../src/viewer/hcm-stories.js';
import { menuAction } from '../../src/viewer/viewer-actions.js';
import { menuActions } from '../../src/viewer/viewer-menu.js';
import { storiesSheet } from '../../src/viewer/viewer-stories.js';
import { mountElement, recordEvents, shadowQueryAll, shadowText } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';
import { fakeServices } from './viewer-harness.js';

const STORY: Story = {
    id: 'teatrul',
    title: { ro: 'Teatrul', en: 'The theatre' },
    body: {
        ro: 'A ars.',
        en: 'It burned in **1944**. <img src=x onerror=alert(1)>\n\n![The front](photo:mihai-voda-1978)\n\n![Lost](photo:lost)\n\n![Gone](photo:nowhere)',
    },
    yearStart: 1852,
    yearEnd: 1944,
    photoIds: ['mihai-voda-1978'],
    poiIds: ['casa-uranus'],
    credit: 'Maria',
};

const OLDER: Story = { id: 'hanul', title: { ro: 'Hanul' }, body: { ro: '![x](photo:uranus-1984)' }, yearStart: 1800 };
const UNDATED: Story = { id: 'fara', title: { ro: 'Fără an' }, body: { ro: 'Text.' } };

function unplaced(): UnplacedPhoto {
    const [photo] = testManifest().photos;
    const entries = Object.entries(photo ?? {}).filter(([key]) => !['location', 'bearing', 'fov'].includes(key));
    return { ...(Object.fromEntries(entries) as unknown as UnplacedPhoto), id: 'lost' };
}

async function mount(properties: Partial<HcmStories>): Promise<HcmStories> {
    const manifest = testManifest();
    return mountElement<HcmStories>(HCM_STORIES_TAG, {
        stories: [STORY, UNDATED, OLDER],
        photos: [...manifest.photos, unplaced()],
        pois: manifest.pois ?? [],
        locale: 'en',
        manifestUrl: TEST_MANIFEST_URL,
        ...properties,
    });
}

describe('<hcm-stories> @S-V50-HAPPY-OPEN', () => {
    beforeAll(() => {
        defineHcmStories();
        defineHcmPhotoSheet();
        defineHcmPoiDetail();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theListOldestFirstEachOpensItsStory', async () => {
        const element = await mount({ storyId: null });
        const events = recordEvents(element, 'hcm-story-select');
        const rows = shadowQueryAll(element, '.row');
        expect(rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'Hanul From 1800',
            'The theatre From 1852 to 1944',
            'Fără an',
        ]);
        rows[1]?.click();
        expect(events).toEqual([{ type: 'hcm-story-select', detail: { storyId: 'teatrul' } }]);
        expect(shadowQueryAll(element, '.row img')).toHaveLength(2);
    });

    it('happyPath_aStoryReadsWithItsFiguresPlacesPhotosAndCredit', async () => {
        const element = await mount({ storyId: 'teatrul' });
        const events = recordEvents(element, 'hcm-photo-select', 'hcm-poi-select', 'hcm-story-select');
        await expect.element(page.getByText('Added by Maria')).toBeVisible();
        expect(shadowQueryAll(element, 'figure')).toHaveLength(2);
        expect(shadowQueryAll(element, 'figcaption').map((caption) => caption.textContent)).toEqual(['The front', 'Lost']);
        expect(shadowQueryAll(element, 'strong').map((bold) => bold.textContent)).toEqual(['1944']);
        shadowQueryAll(element, 'figure button')[0]?.click();
        shadowQueryAll(element, 'section button')[0]?.click();
        shadowQueryAll(element, 'section button')[1]?.click();
        shadowQueryAll(element, 'button.link').at(-1)?.click();
        expect(events.map((event) => event.detail)).toEqual([
            { photoId: 'mihai-voda-1978' },
            { poiId: 'casa-uranus' },
            { photoId: 'mihai-voda-1978' },
            { storyId: null },
        ]);
    });

    it('happyPath_aStoryIsFoundFromItsPhotoAndItsPlace', async () => {
        const manifest = testManifest();
        const [photo] = manifest.photos;
        const sheet = await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
            photo: photo ?? null,
            stories: [STORY],
            open: true,
            mode: 'bottom',
            locale: 'en',
        });
        const events = recordEvents(sheet, 'hcm-story-select');
        await expect.element(page.getByRole('button', { name: 'The theatre' })).toBeVisible();
        await page.getByRole('button', { name: 'The theatre' }).click();
        expect(events).toEqual([{ type: 'hcm-story-select', detail: { storyId: 'teatrul' } }]);
        sheet.photo = null;
        sheet.poi = manifest.pois?.[0] ?? null;
        await sheet.updateComplete;
        await expect.element(page.getByRole('button', { name: 'The theatre' })).toBeVisible();
    });

    it('happyPath_theMenuOffersStoriesAndOpensTheirList', () => {
        const manifest = { ...testManifest(), stories: [STORY] };
        expect(menuActions({ webgl: true, layersDocked: false, manifest })).toContain('stories');
        expect(menuActions({ webgl: true, layersDocked: false, manifest: testManifest() })).not.toContain('stories');
        const store = new FakeStore(readyState());
        menuAction(store, fakeServices(), 'stories');
        expect(store.callsOf('openStory')).toEqual([[null]]);
    });

    it('happyPath_theSheetIsTitledByTheOpenStoryAndCloses', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const seen: string[] = [];
        const handlers = {
            onSheetClose: (event: Event) => seen.push(event.type),
            onStorySelect: () => seen.push('story'),
            onPhotoSelect: () => seen.push('photo'),
            onPoiSelect: () => seen.push('poi'),
        };
        const manifest = { ...testManifest(), stories: [STORY], unplaced: [unplaced()] };
        const placeless = Object.fromEntries(Object.entries(testManifest()).filter(([key]) => key !== 'pois')) as Manifest;
        render(
            storiesSheet({ locale: 'en', manifestUrl: '', storyId: 'teatrul' }, manifest, { mode: 'docked', open: true }, handlers),
            host,
        );
        expect(host.querySelector('h2')?.textContent).toBe('The theatre');
        host.querySelector('hcm-icon-button')?.dispatchEvent(new Event('click'));
        render(
            storiesSheet(
                { locale: 'ro', manifestUrl: '', storyId: null },
                placeless,
                { mode: 'bottom', open: false, inert: true },
                handlers,
            ),
            host,
        );
        expect(host.querySelector('.stories-sheet')?.hasAttribute('inert')).toBe(true);
        expect(seen).toEqual(['hcm-close']);
    });
});

describe('<hcm-stories>: a bare story', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aFigureWithNoCaptionIsNamedByItsPhotoAndAStoryWithNoLinksHasNoSections', async () => {
        const bare: Story = { id: 'bare', title: { ro: 'Goală' }, body: { ro: '![](photo:mihai-voda-1978)' } };
        const element = await mount({ stories: [bare], storyId: 'bare', locale: 'ro' });
        expect(shadowQueryAll(element, 'figure img')[0]?.getAttribute('alt')).toBeTruthy();
        expect(shadowQueryAll(element, 'figcaption')).toHaveLength(0);
        expect(shadowQueryAll(element, 'section')).toHaveLength(0);
        expect(shadowQueryAll(element, '.years')).toHaveLength(0);
    });
});

describe('<hcm-stories>: refusals @S-V50-BAD-MARKUP-IS-TEXT', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_markupInAStoryIsTextAndAFigureOfAPhotoNotListedIsLeftOut', async () => {
        const element = await mount({ storyId: 'teatrul' });
        expect(shadowText(element)).toContain('<img src=x onerror=alert(1)>');
        expect(shadowQueryAll(element, 'img').map((image) => image.getAttribute('src'))).not.toContain('x');
        expect(shadowQueryAll(element, 'figcaption').map((caption) => caption.textContent)).not.toContain('Gone');
        // A photo with no place yet shows, and does not pretend to open on the map.
        expect(shadowQueryAll(element, 'figure button')).toHaveLength(1);
    });

    it('badPath_anUnknownStoryShowsTheListAndAThumbnailThatCannotBeResolvedShowsNone', async () => {
        const element = await mount({ storyId: 'nope', manifestUrl: 'https://[', stories: [STORY] });
        expect(shadowQueryAll(element, '.row')).toHaveLength(1);
        expect(shadowQueryAll(element, 'img')).toHaveLength(0);
    });
});
