// M28 (docs/research/M28-sources.md §10, §11): the Sources card's free translation options and the country finder.
import { COUNTRY_SEEDS } from '@hcm/shared/country-seeds';
import type { CountryPlace } from '@hcm/shared/sources';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineHcmSetupSources, type HcmSetupSources } from '../../../src/admin/setup/hcm-setup-sources.js';
import type { CountryFinderView } from '../../../src/admin/setup/setup-port.js';
import { cleanup, fixture } from '../../helpers.js';
import { FakeSetupPort, FINDER_NONE, setupView } from './fixtures.js';

defineHcmSetupSources();

const RO_PLACES = COUNTRY_SEEDS['RO']?.places ?? [];

const READY: CountryFinderView = {
    state: 'ready',
    country: 'RO',
    language: 'ro',
    origin: 'curated',
    factsCheckedOn: '2026-11-14',
    refreshedAt: '2026-11-14T10:00:00.000Z',
    places: RO_PLACES.map((place, index) => ({ ...place, ...(index === 1 ? { reachable: false } : { reachable: true }) })),
    cityName: 'București',
};

async function sources(finder: CountryFinderView, locale = 'en') {
    const view = setupView();
    const port = new FakeSetupPort({ ...view, sources: { ...view.sources, finder } });
    return fixture<HcmSetupSources>(
        html`<hcm-setup-sources .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-sources>`,
    );
}

function text(element: Element): string {
    return element.shadowRoot?.textContent.replace(/\s+/g, ' ') ?? '';
}

function place(element: Element, id: string): HTMLElement {
    const found = element.shadowRoot?.querySelector<HTMLElement>(`[data-place="${id}"]`);
    if (found === null || found === undefined) {
        throw new Error(`no place ${id}`);
    }
    return found;
}

function link(root: ParentNode, label: string): HTMLAnchorElement | undefined {
    return [...root.querySelectorAll<HTMLAnchorElement>('a.action')].find((anchor) => anchor.textContent.trim() === label);
}

describe('the free translation options', () => {
    afterEach(cleanup);

    it('happyPath_eachCardShowsQualityLimitPrivacyAndItsSignUpWizard @S-A184-HAPPY-TRANSLATIONS', async () => {
        const element = await sources(FINDER_NONE);
        const deepl = element.shadowRoot?.querySelector<HTMLElement>('[data-translation="deeplFree"]');

        expect(element.shadowRoot?.querySelectorAll('[data-translation]')).toHaveLength(6);
        expect(deepl?.textContent).toContain('500,000 characters a month.');
        expect(deepl?.textContent).toContain('Past the limit the service stops until next month; you pay nothing.');
        expect(deepl?.textContent).toContain("The free plan's terms let the provider keep the texts sent.");
        expect(link(deepl ?? document, 'Open the page')?.href).toContain('https://www.deepl.com/en/signup');
        const local = element.shadowRoot?.querySelector<HTMLElement>('[data-translation="localModels"]');
        expect(local?.textContent).toContain('each text is translated back and compared before it is used');
        expect(link(local ?? document, 'Open in the app')?.getAttribute('href')).toBe('#/jobs');
        expect(text(element)).toContain('linking them is planned');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aLimitOrPrivacyTheProviderDoesNotStateIsSaidSo_inRomanian', async () => {
        const element = await sources(FINDER_NONE, 'ro');
        const memory = element.shadowRoot?.querySelector<HTMLElement>('[data-translation="myMemory"]');

        expect(memory?.textContent).toContain('50.000 de caractere pe zi.');
        expect(memory?.textContent).toContain('Furnizorul nu spune ce se întâmplă peste limită.');
        expect(memory?.textContent).toContain('Furnizorul nu spune clar ce face cu textele.');
        expect(element.shadowRoot?.querySelector('[data-translation="googleTranslate"]')?.textContent).toContain(
            'Peste limită, se plătește din contul de facturare.',
        );
    });
});

describe('the country finder', () => {
    afterEach(cleanup);

    it('happyPath_romaniasCuratedPlacesWithAVisitGuideAndAReadyRequest @S-A183-HAPPY-FINDER', async () => {
        const element = await sources(READY);
        const archives = place(element, 'anrCentral');

        expect(text(element)).toContain('Where to find old maps and images: Romania');
        expect(text(element)).toContain("List checked by a person on the institutions' pages on");
        expect(element.shadowRoot?.querySelectorAll('[data-place]')).toHaveLength(RO_PLACES.length);
        expect(archives.textContent).toContain('Planuri și Hotărnicii 1700-1915');
        expect(link(archives, 'Open the way there in Google Maps')?.href).toBe(
            'https://www.google.com/maps/dir/?api=1&destination=Bulevardul%20Regina%20Elisabeta%2049%2C%20Bucure%C8%99ti',
        );
        const mail = link(archives, 'Write the email (filled in)')?.href ?? '';
        expect(mail.startsWith('mailto:saladestudiu@arhivelenationale.ro?subject=')).toBe(true);
        expect(decodeURIComponent(mail)).toContain('a orașului București');
        expect(link(archives, 'Call 021 303 70 80')?.getAttribute('href')).toBe('tel:0213037080');
        expect(link(archives, 'Open the import from your computer')?.getAttribute('href')).toBe('#/imagery/upload');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anOnlinePlaceGuidesTheAccountTheSiteTheStatusAndTheImport', async () => {
        const element = await sources(READY, 'ro');
        const copernicus = place(element, 'copernicus');

        expect(link(copernicus, 'Fă-ți contul pe site')?.href).toBe('https://browser.dataspace.copernicus.eu/');
        expect(copernicus.textContent).toContain('Cheile furnizorului servesc doar uneltelor lui');
        expect(copernicus.textContent).toContain('Site-ul a răspuns la ultima verificare automată');
        expect(link(copernicus, 'Deschide Imagini istorice → Încarcă')?.getAttribute('href')).toBe('#/imagery/upload');
        expect(place(element, 'aiga').textContent).toContain('Nu trebuie cont.');
    });

    it('badPath_aPlaceWithoutEmailIsPrinted_andAnUnansweringSiteIsSaid @S-A183-BAD-NO-EMAIL', async () => {
        const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
        const element = await sources(READY);
        const ancpi = place(element, 'ancpi');

        expect(ancpi.textContent).toContain('The institution publishes no email address');
        ancpi.querySelector<HTMLButtonElement>('button.action')?.click();
        expect(print).toHaveBeenCalledOnce();
        expect(place(element, 'anrBucharest').textContent).toContain('The website did not answer at the last automatic check');
        print.mockRestore();
    });

    it('badPath_theListNotReadyUnreadableOrStillReadingSaysWhatToDo @S-A183-BAD-NOT-YET', async () => {
        const none = await sources(FINDER_NONE);
        expect(text(none)).toContain('Where to find old maps and images in your country');
        expect(text(none)).toContain('the app looks it up by itself at its next regular check (within an hour)');
        cleanup();
        const failed = await sources({ ...FINDER_NONE, state: 'failed' });
        expect(text(failed)).toContain('open Admins and check you have a role in this city');
        cleanup();
        const loading = await sources({ ...FINDER_NONE, state: 'loading' });
        expect(text(loading)).toContain('Reading the list…');
    });

    it('happyPath_aResearchedListSaysItIsUncheckedAndAnUncheckedSiteWaits', async () => {
        const researched: CountryPlace = {
            id: 'Q1',
            name: { ro: 'National Archives of Moldova', en: 'National Archives of Moldova' },
            kind: 'archive',
            access: 'both',
            cost: 'unknown',
            materials: [],
            url: 'https://arhiva.gov.md/',
            verified: false,
            online: { key: 'none', howTo: { ro: 'Căutați.', en: 'Search.' }, importRoute: 'photos' },
        };
        const element = await sources({ ...READY, country: 'MD', origin: 'researched', factsCheckedOn: null, places: [researched] });

        expect(text(element)).toContain('Found automatically in open data (Wikidata)');
        expect(text(element)).toContain('The website is not checked yet');
        expect(link(place(element, 'Q1'), 'Open Photos')?.getAttribute('href')).toBe('#/photos');
    });

    it('badPath_aListWithoutItsDatesSaysTheSitesAreNotCheckedYet', async () => {
        const element = await sources({ ...READY, factsCheckedOn: null, refreshedAt: null });

        expect(text(element)).not.toContain('List checked by a person');
        expect(place(element, 'copernicus').textContent).toContain('The website is not checked yet');
    });
});
