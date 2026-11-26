import { afterEach, describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import {
    renderLegalPage,
    SITE_VERIFICATION_ENV,
    siteVerificationOf,
    START_SITE_STYLESHEET_FILE,
    startFooter,
    writeLegalFiles,
} from '../src/start/legal.js';
import { PERMISSIONS_URL, PRIVACY_PAGE, TERMS_PAGE, USER_DATA_POLICY_URL } from '../src/start/legal-text.js';
import { renderStartPage } from '../src/start/tree.js';
import { cleanup, repositoryWithTemporaryDist } from './support.js';

afterEach(cleanup);

/** What Google's OAuth verification asks of the start site (docs/research/M14-start-your-map.md §10). */
describe('the start site for Google verification', () => {
    it('happyPath_thePrivacyPolicySaysWhatThePageDoes', () => {
        const page = renderLegalPage(PRIVACY_PAGE);
        for (const text of [
            'https://www.googleapis.com/auth/cloudplatformprojects',
            'https://www.googleapis.com/auth/firebase',
            'sessionStorage',
            'no cookies',
            'Limited Use',
            `href="${USER_DATA_POLICY_URL}"`,
            `href="${PERMISSIONS_URL}"`,
            'Politica de confidențialitate',
            '<section lang="en" aria-labelledby="en">',
            `href="${START_SITE_STYLESHEET_FILE}"`,
        ]) {
            expect(page).toContain(text);
        }
        expect(page).not.toContain('<script');
        expect(page).toContain("script-src 'none'");
    });

    it('happyPath_theTermsSayAsIsAndTheOwnersBills', () => {
        const page = renderLegalPage(TERMS_PAGE);
        expect(page).toContain('"as is"');
        expect(page).toContain('Blaze');
        expect(page).toContain('Condiții de utilizare');
    });

    it('happyPath_theHomePageNamesTheAppAndLinksBothPages', () => {
        const page = renderStartPage();
        expect(page).toContain('Historic City Map Maker');
        expect(page).toContain('href="privacy.html"');
        expect(page).toContain('href="terms.html"');
        expect(page.indexOf('<hcm-start-page>')).toBeLessThan(page.indexOf('<footer'));
        expect(startFooter().tag).toBe('footer');
    });

    it.each(['google0123abcd.html', 'google81a1ffad6e76455f.html'])('happyPath_theVerificationFile %s', (name) => {
        expect(siteVerificationOf({ [SITE_VERIFICATION_ENV]: name })).toBe(name);
        const { files } = repositoryWithTemporaryDist();
        writeLegalFiles('dist/legal', name, files);
        expect(files.readText(`dist/legal/${name}`)).toBe(`google-site-verification: ${name}`);
        expect(files.isFile('dist/legal/privacy.html')).toBe(true);
    });

    it('happyPath_noVerificationNoFile', () => {
        expect(siteVerificationOf({})).toBeUndefined();
        expect(siteVerificationOf({ [SITE_VERIFICATION_ENV]: '' })).toBeUndefined();
        const { files } = repositoryWithTemporaryDist();
        writeLegalFiles('dist/legal', undefined, files);
        expect(files.listFiles('dist/legal').sort((left, right) => left.localeCompare(right))).toEqual([
            'privacy.html',
            'start-site.css',
            'terms.html',
        ]);
    });

    it.each(['index.html', 'google.html', 'google0123ABCD.html', 'google0123abcd.htm', '../google0123abcd.html', 'google0123abcd.html/x'])(
        'badPath_aNameThatIsNoVerificationFileIsRefused %s',
        (name) => {
            expect(() => siteVerificationOf({ [SITE_VERIFICATION_ENV]: name })).toThrow(SiteBuildError);
        },
    );
});
