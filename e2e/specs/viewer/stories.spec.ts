import { STORY_ID, openStories, storyManifest } from '../../tour/story-states.js';
import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { callController, hashParam, menuButton, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * M17's stories on the public map (docs/research/M17-stories.md §5; behaviour V50): found in the menu, in a photo's sheet and by
 * their own link; read with their figures, places and photos; the text is ours to render, so markup stays text.
 */

test('A story is found in the menu and reads with its figure, places and photos', { tag: '@S-V50-HAPPY-OPEN' }, async ({ page }) => {
    await serveManifest(page, storyManifest());
    await openViewer(page, { lang: 'en' });
    await openStories(page, 'en');
    const stories = viewer(page).locator('hcm-stories');
    await expect(stories.getByRole('listitem')).toHaveCount(2);
    await stories.getByRole('button', { name: 'The National Theatre' }).click();
    await expect(viewer(page).getByRole('heading', { name: 'The National Theatre' })).toBeVisible();
    await expect(stories.locator('strong')).toHaveText('1944');
    await expect(stories.locator('figcaption')).toHaveText(['The front']);
    await expect(stories.getByText(t('en', 'photo.credit', { name: 'Maria' }))).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toContain(`story=${STORY_ID}`);
    await stories.locator('figure button').click();
    await expect(viewer(page).locator('hcm-photo-sheet').getByRole('button', { name: 'The National Theatre' })).toBeVisible();
});

test('A story opens from its own link, and from the photo it is about', { tag: '@S-V50-HAPPY-LINK' }, async ({ page }) => {
    const manifest = storyManifest();
    await serveManifest(page, manifest);
    await openViewer(page, { lang: 'ro', hash: `story=${STORY_ID}` });
    await expect(viewer(page).getByRole('heading', { name: 'Teatrul Național' })).toBeVisible();
    await expect(viewer(page).locator('hcm-stories').getByRole('link', { name: 'sursă' })).toHaveAttribute(
        'href',
        'https://example.org/teatrul',
    );
    const [photo] = manifest['photos'] as readonly { readonly id: string }[];
    await callController(page, 'openPhoto', String(photo?.id));
    await viewer(page).locator('hcm-photo-sheet').getByRole('button', { name: 'Teatrul Național' }).click();
    await expect(viewer(page).getByRole('heading', { name: 'Teatrul Național' })).toBeVisible();
});

test('Opening a story moves the timeline to its year and shows that layer', { tag: '@S-V50-HAPPY-TIMELINE' }, async ({ page }) => {
    await serveManifest(page, storyManifest());
    await openViewer(page, { lang: 'en' });
    const slider = page.getByRole('slider', { name: t('en', 'timeline.label'), exact: true });
    await expect(slider).toHaveAttribute('aria-valuetext', t('en', 'timeline.present'));
    await openStories(page, 'en');
    await viewer(page).locator('hcm-stories').getByRole('button', { name: 'The National Theatre' }).click();
    await expect(slider).toHaveAttribute('aria-valuetext', t('en', 'timeline.year', { year: '1966' }));
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
});

test(
    "A story's link with its own layers keeps them instead of the story's year",
    { tag: '@S-V50-BAD-TIMELINE-LINK-LAYERS' },
    async ({ page }) => {
        await serveManifest(page, storyManifest());
        await openViewer(page, { lang: 'en', hash: `layers=${E2E_XYZ_LAYER.id}&story=${STORY_ID}` });
        const slider = page.getByRole('slider', { name: t('en', 'timeline.label'), exact: true });
        await expect(viewer(page).getByRole('heading', { name: 'The National Theatre' })).toBeVisible();
        await expect(slider).toHaveAttribute('aria-valuetext', t('en', 'timeline.year', { year: '1980' }));
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);
        await expect.poll(() => hashParam(page, 'story')).toBe(STORY_ID);
    },
);

test('A link to a story that does not exist shows a toast and opens nothing', { tag: '@S-V50-BAD-UNKNOWN' }, async ({ page }) => {
    await serveManifest(page, storyManifest());
    await openViewer(page, { lang: 'en', hash: 'story=no-such-story' });
    await expect(page.getByRole('status').filter({ hasText: t('en', 'error.unknownStory') })).toBeVisible();
    await expect(viewer(page).getByRole('heading', { name: 'The National Theatre' })).toHaveCount(0);
});

test(
    'Markup in a story is text, and a figure of a photo the map does not have is left out',
    { tag: '@S-V50-BAD-MARKUP-IS-TEXT' },
    async ({ page }) => {
        await serveManifest(page, storyManifest());
        await openViewer(page, { lang: 'en', hash: `story=${STORY_ID}` });
        const stories = viewer(page).locator('hcm-stories');
        await expect(stories.getByText('<b>not bold</b>', { exact: false })).toBeVisible();
        await expect(stories.locator('b')).toHaveCount(0);
        await expect(stories.locator('figure')).toHaveCount(1);
    },
);

test('A manifest without stories has no Stories in its menu', { tag: '@S-V50-BAD-OLD-MANIFEST' }, async ({ page }) => {
    await serveManifest(page, siteManifestData());
    await openViewer(page, { lang: 'en' });
    await menuButton(page, 'en').click();
    await expect(viewer(page).getByRole('menuitem', { name: t('en', 'about.title') })).toBeVisible();
    await expect(viewer(page).getByRole('menuitem', { name: t('en', 'stories.title') })).toHaveCount(0);
});
