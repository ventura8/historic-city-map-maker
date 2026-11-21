import { UNPLACED_CONTRIBUTE_URL, unplacedManifest } from '../../tour/unplaced-states.js';
import { siteManifestData } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { callController, chooseMenuItem, menuButton, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The public map's side of M13 (docs/research/M13-roles.md §5; behaviours V40, V41): the gallery of the photos with no place and a
 * link to the Contribute page, and nothing else: no sign-in, no Firestore, no cookie.
 */
const CONTRIBUTE = UNPLACED_CONTRIBUTE_URL;

test.beforeEach(async ({ context }) => {
    await context.route('https://contribute.e2e.test/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<title>Contribute</title>' }),
    );
});

test(
    'A photo with no place waits in the gallery, says whose it is and links to its suggestion page',
    { tag: ['@S-V40-HAPPY-GALLERY', '@S-V40-HAPPY-RIGHTS'] },
    async ({ page }) => {
        await serveManifest(page, unplacedManifest());
        await openViewer(page, { lang: 'en' });
        await chooseMenuItem(page, 'en', t('en', 'unplaced.title'));
        const gallery = viewer(page).locator('hcm-unplaced-gallery');
        await expect(gallery.getByRole('list', { name: t('en', 'unplaced.title') }).getByRole('listitem')).toHaveCount(1);
        const [photo] = unplacedManifest()['unplaced'] as readonly { readonly id: string; readonly license: string }[];
        await expect(gallery.getByText(t('en', `license.${String(photo?.license)}` as never))).toBeVisible();
        await expect(gallery.getByRole('link', { name: t('en', 'unplaced.suggest') })).toHaveAttribute(
            'href',
            `${CONTRIBUTE}/${String(photo?.id)}`,
        );
    },
);

test(
    'A manifest from before it shows neither the gallery nor the link',
    { tag: ['@S-V40-BAD-OLD-MANIFEST', '@S-V41-BAD-NO-BACKEND', '@S-V40-HAPPY-OLD-MANIFEST'] },
    async ({ page }) => {
        await serveManifest(page, siteManifestData());
        await openViewer(page, { lang: 'en' });
        await menuButton(page, 'en').click();
        await expect(viewer(page).getByRole('menuitem', { name: t('en', 'about.title') })).toBeVisible();
        await expect(viewer(page).getByRole('menuitem', { name: t('en', 'unplaced.title') })).toHaveCount(0);
        await expect(viewer(page).getByRole('menuitem', { name: t('en', 'contribute.link') })).toHaveCount(0);
    },
);

test('A map with no Contribute page shows the gallery without links', { tag: '@S-V40-BAD-NO-BACKEND' }, async ({ page }) => {
    await serveManifest(page, { ...unplacedManifest(), contributeUrl: undefined });
    await openViewer(page, { lang: 'en' });
    await chooseMenuItem(page, 'en', t('en', 'unplaced.title'));
    const gallery = viewer(page).locator('hcm-unplaced-gallery');
    await expect(gallery.getByRole('listitem')).toHaveCount(1);
    await expect(gallery.getByRole('link')).toHaveCount(0);
});

test('A photo with a credit says it, and offers a correction', { tag: '@S-V41-HAPPY-CORRECTION-LINK' }, async ({ page }) => {
    const manifest = unplacedManifest();
    const [photo, ...rest] = manifest['photos'] as readonly Record<string, unknown>[];
    await serveManifest(page, { ...manifest, photos: [{ ...photo, credit: 'Maria' }, ...rest] });
    await openViewer(page, { lang: 'en' });
    await callController(page, 'openPhoto', String(photo?.['id']));
    const sheet = viewer(page).locator('hcm-photo-sheet');
    await expect(sheet.getByText(t('en', 'photo.credit', { name: 'Maria' }))).toBeVisible();
    await expect(sheet.getByRole('link', { name: t('en', 'photo.suggest') })).toHaveAttribute(
        'href',
        `${CONTRIBUTE}/${String(photo?.['id'])}`,
    );
});

test(
    'Contribute opens a page of its own, and the map signs nothing in',
    { tag: ['@S-V41-HAPPY-LINK', '@S-V41-BAD-NO-SIGN-IN'] },
    async ({ page, context }) => {
        const asked: string[] = [];
        page.on('request', (request) => asked.push(request.url()));
        await serveManifest(page, unplacedManifest());
        await openViewer(page, { lang: 'en' });
        const [popup] = await Promise.all([context.waitForEvent('page'), chooseMenuItem(page, 'en', t('en', 'contribute.link'))]);
        // M13 §3: the page's signed-out welcome speaks the map's language and names the city.
        const name = (unplacedManifest()['city'] as { readonly name: { readonly en: string } }).name.en;
        await expect(popup).toHaveURL(CONTRIBUTE.replace('#', `?lang=en&name=${encodeURIComponent(name)}#`));
        expect(await context.cookies()).toEqual([]);
        expect(asked.filter((url) => /firestore|identitytoolkit|securetoken|firebase/.test(url))).toEqual([]);
    },
);
