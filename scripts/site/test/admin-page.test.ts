import { describe, expect, it } from 'vitest';

import { DEFAULT_TAB_ICONS } from '@hcm/shared/tab-icon';

import {
    ADMIN_PAGE,
    ADMIN_SCRIPT_FILE,
    ADMIN_SHELL_ELEMENT,
    ADMIN_STYLESHEET_FILE,
    MAPBOX_INTEGRITY_ATTRIBUTE,
    renderAdminPage,
} from '../src/admin/page.js';
import { htmlValidateMessages } from './support.js';

describe('renderAdminPage', () => {
    it('happyPath_passesTheRepositoryHtmlValidateRules', async () => {
        expect(await htmlValidateMessages(renderAdminPage(), 'packages/admin/dist/index.html')).toEqual([]);
    });

    it('happyPath_namesTheMapboxDigestTheLoaderReads', async () => {
        const digest = `sha384-${'x'.repeat(64)}`;
        const html = renderAdminPage(ADMIN_PAGE, { mapboxGlIntegrity: digest });

        // The loader of @hcm/ui/map reads the same attribute (MAPBOX_INTEGRITY_ATTRIBUTE there).
        expect(MAPBOX_INTEGRITY_ATTRIBUTE).toBe('data-mapbox-integrity');
        expect(html).toContain(`<html lang="ro" data-mapbox-integrity="${digest}">`);
        expect(await htmlValidateMessages(html, 'packages/admin/dist/index.html')).toEqual([]);
    });

    it('happyPath_loadsTheStylesheetThenTheBundleAndHoldsTheShell', () => {
        const html = renderAdminPage();

        expect([...html.matchAll(/<(?:script|link) [^>]*>/g)].map(([tag]) => tag)).toEqual([
            `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)" href="${DEFAULT_TAB_ICONS.light}">`,
            `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)" href="${DEFAULT_TAB_ICONS.dark}">`,
            '<link rel="manifest" href="app.webmanifest">',
            '<link rel="apple-touch-icon" href="app-icon-192.png">',
            `<link rel="stylesheet" href="${ADMIN_STYLESHEET_FILE}">`,
            '<script src="app.js" defer>',
            `<script type="module" src="${ADMIN_SCRIPT_FILE}">`,
        ]);
        expect(html).toContain(`<${ADMIN_SHELL_ELEMENT}></${ADMIN_SHELL_ELEMENT}>`);
        expect(html).toContain('<html lang="ro">');
        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('badPath_noMetaPolicyNoInlineCodeAndABilingualNoScriptNote', () => {
        const html = renderAdminPage({ ...ADMIN_PAGE, lang: 'en', title: 'Admin <&>' });

        // Hosting sends the policy as a header (firebase.json); a meta copy would drift and could only tighten it.
        expect(html).not.toContain('Content-Security-Policy');
        expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
        expect(html).not.toContain('<style');
        expect(html).toContain('<title>Admin &lt;&amp;&gt;</title>');
        expect(html).toContain(`<p lang="ro" class="admin-noscript">${ADMIN_PAGE.noscript.ro}</p>`);
        expect(html).toContain(`<p lang="en" class="admin-noscript">${ADMIN_PAGE.noscript.en}</p>`);
    });
});
