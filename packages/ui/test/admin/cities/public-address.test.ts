import type { CityDoc } from '@hcm/shared';
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { publicAddressLink, publicCityAddress } from '../../../src/admin/cities/public-address.js';
import { publishSection } from '../../../src/admin/settings/publish-section.js';
import type { SectionContext } from '../../../src/admin/settings/section-parts.js';
import { cityDoc, draftOf, settingsState } from '../layers/fixtures.js';

/**
 * A city's public address on the project's Hosting site (docs/research/M6-interfaces.md §2.4, CR-M6-17): the admin's
 * own origin with the city id as the path, shown by New city's done screen and Settings → Publishing.
 */

const containers: HTMLElement[] = [];

function shown(template: Parameters<typeof render>[0]): HTMLElement {
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    render(template, container);
    return container;
}

function publishContext(city: CityDoc, cityId: string | null | undefined): SectionContext {
    const base = settingsState();
    return {
        locale: 'ro',
        view: { ...base, section: 'publish', citySection: { ...base.citySection, section: 'publish', draft: draftOf(city) } },
        intents: null,
        href: (params) => `#/settings/${params.join('/')}`,
        go: () => undefined,
        announce: () => undefined,
        readOnly: false,
        who: { self: null, people: {} },
        refresh: () => undefined,
        ...(cityId === undefined ? {} : { cityId }),
    };
}

describe('the public address of a city', () => {
    afterEach(() => {
        containers.splice(0).forEach((container) => {
            container.remove();
        });
    });

    it('happyPath_theAdminsOriginWithTheCityIdAsThePath', () => {
        expect(publicCityAddress('bacau', 'https://bucurestiul-disparut.web.app/admin/')).toBe(
            'https://bucurestiul-disparut.web.app/bacau/',
        );
        expect(publicCityAddress('cluj', 'https://demo-hcm.firebaseapp.com/admin/#/settings/publish')).toBe(
            'https://demo-hcm.firebaseapp.com/cluj/',
        );
    });

    it('happyPath_theLinkOpensANewTabAndSaysSoInRomanian', () => {
        const link = shown(publicAddressLink('ro', 'bacau', 'https://bucurestiul-disparut.web.app/admin/')).querySelector('a');

        expect(link?.getAttribute('href')).toBe('https://bucurestiul-disparut.web.app/bacau/');
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link?.textContent).toContain('https://bucurestiul-disparut.web.app/bacau/');
        expect(link?.querySelector('.visually-hidden')?.textContent).toContain('filă nouă');
    });

    it('happyPath_withoutABaseTheDocumentsOwnOriginIsUsed', () => {
        const link = shown(publicAddressLink('en', 'cluj')).querySelector('a');

        expect(link?.getAttribute('href')).toBe(new URL('/cluj/', document.baseURI).href);
        expect(link?.textContent).toContain('opens in a new tab');
    });

    it('happyPath_publishingNamesTheShellsCityElseTheDocumentsOwnId', () => {
        const fromShell = shown(publishSection(publishContext(cityDoc({ id: 'other' }), 'bacau'))).querySelector('a[data-public-address]');
        const fromDoc = shown(publishSection(publishContext(cityDoc({ id: 'cluj' }), null))).querySelector('a[data-public-address]');

        expect(fromShell?.getAttribute('href')).toBe(new URL('/bacau/', document.baseURI).href);
        expect(fromDoc?.getAttribute('href')).toBe(new URL('/cluj/', document.baseURI).href);
    });

    it('badPath_withNoCityIdPublishingShowsNoAddress', () => {
        const section = shown(publishSection(publishContext(cityDoc(), undefined)));

        expect(section.querySelector('[data-publish-site]')).not.toBeNull();
        expect(section.querySelector('a[data-public-address]')).toBeNull();
    });
});
