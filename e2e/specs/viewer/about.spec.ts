import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * About, credits and privacy (behaviour V13): rendered from the manifest in the visitor's language, the Markdown
 * subset walked into DOM nodes so markup in the data stays visible text (docs/research/design-review-security-cost.md
 * §1.7), and empty credits hide their section.
 */

interface Credit {
    readonly label: { readonly ro: string; readonly en: string };
}

const CITY = siteManifestData()['city'] as { name: { ro: string; en: string }; credits: Credit[] };
/** The engine's release is the repository's version: `ENGINE_VERSION` follows the root package.json (docs/releases/README.md). */
const ROOT_PACKAGE = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { version: string };

test('About shows the city, its credits and privacy notice in the visitor language', { tag: '@S-V13-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    await chooseMenuItem(page, lang, t(lang, 'about.title'));

    await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
    // The content is slotted into the kit's dialog, so it is found inside the About element, not the dialog box.
    const dialog = viewer(page).locator('hcm-about-dialog');
    await expect(dialog.getByRole('heading', { name: CITY.name[lang], exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: t(lang, 'about.credits') })).toBeVisible();
    for (const credit of CITY.credits) {
        await expect(dialog.getByText(credit.label[lang], { exact: true })).toBeAttached();
    }
    await expect(dialog.getByRole('heading', { name: t(lang, 'about.privacy') })).toBeVisible();
    await expect(dialog.getByRole('link', { name: lang === 'ro' ? 'politica Mapbox' : 'Mapbox privacy policy' })).toHaveAttribute(
        'rel',
        'noopener noreferrer nofollow ugc',
    );
    await expect(dialog.getByText(t(lang, 'about.engine', { version: ROOT_PACKAGE.version }))).toBeAttached();
    await expect(viewer(page).locator('hcm-about-dialog strong').first()).toHaveText(CITY.name[lang]);
});

test('Without credits the credits section is not shown', { tag: '@S-V13-BAD-EMPTY-CREDITS' }, async ({ page, lang }) => {
    const manifest = siteManifestData();
    (manifest['city'] as Json)['credits'] = [];
    await serveManifest(page, manifest);
    await openViewer(page, { lang });
    await chooseMenuItem(page, lang, t(lang, 'about.title'));

    await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
    const dialog = viewer(page).locator('hcm-about-dialog');
    await expect(dialog.getByRole('heading', { name: t(lang, 'about.privacy') })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: t(lang, 'about.credits') })).toHaveCount(0);
});

/** No underscore in the handler: `_` is the Markdown emphasis marker and would split the text. */
const MARKUP = 'Text <img src="x" onerror="document.body.dataset.pwned=1"> și **gros** cu [o legătură](https://example.org/about-e2e).';

test(
    'Markup in About stays text; only the Markdown subset makes elements',
    { tag: '@S-V13-BAD-MARKUP-IS-TEXT' },
    async ({ page, lang }) => {
        const manifest = siteManifestData();
        (manifest['city'] as Json)['about'] = { ro: MARKUP, en: MARKUP };
        await serveManifest(page, manifest);
        await openViewer(page, { lang });
        await chooseMenuItem(page, lang, t(lang, 'about.title'));

        await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
        const dialog = viewer(page).locator('hcm-about-dialog');
        await expect(dialog.getByText('<img src="x" onerror="document.body.dataset.pwned=1">', { exact: false })).toBeVisible();
        await expect(viewer(page).locator('hcm-about-dialog img')).toHaveCount(0);
        await expect(viewer(page).locator('hcm-about-dialog strong', { hasText: 'gros' })).toBeVisible();
        const link = dialog.getByRole('link', { name: 'o legătură' });
        await expect(link).toHaveAttribute('href', 'https://example.org/about-e2e');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(page.locator('body')).not.toHaveAttribute('data-pwned');
    },
);
