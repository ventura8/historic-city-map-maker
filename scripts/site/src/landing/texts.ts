import { SiteBuildError } from '../errors.js';

/**
 * The words of the project's landing page on GitHub Pages (`docs/research/DECISIONS-for-review.md` §162), in English (the
 * page at `index.html`) and Romanian (`ro.html`). Each language is a complete catalogue: the build refuses a key that is
 * missing or empty in either one, so a page never shows a hole. Plain text only; the page writes it with `textContent`
 * semantics (`../html.ts`).
 */

export const LANDING_LANGUAGES = ['en', 'ro'] as const;
export type LandingLanguage = (typeof LANDING_LANGUAGES)[number];

export const LANDING_KEYS = [
    'title',
    'description',
    'lead',
    'point.photos',
    'point.imagery',
    'point.admin',
    'start.action',
    'start.note',
    'terminal.heading',
    'terminal.text',
    'example.heading',
    'example.text',
    'example.link',
    'links.heading',
    'link.repository',
    'link.setup',
    'link.selfHost',
    'link.engineApi',
    'link.releases',
    'link.privacy',
    'link.terms',
    'switch.label',
    'switch.name',
    'footer',
] as const;
type LandingKey = (typeof LANDING_KEYS)[number];

/** One language's words: every key of {@link LANDING_KEYS}. */
export type LandingCatalogue = Readonly<Record<LandingKey, string>>;

const EN: LandingCatalogue = {
    title: 'Historic City Map Maker',
    description: 'Make a historical map of your city: old photos, vanished places and maps of the past over today’s map.',
    lead: 'Historic City Map Maker makes a historical map of any city: old photos, vanished places, stories and maps of the past over today’s map, with an admin that does almost everything for you.',
    'point.photos': 'Old photos placed where they were taken, each with the direction the camera faced, beside places and stories.',
    'point.imagery':
        'Historical imagery (declassified USGS frames, Landsat, scanned maps of your own) found, georeferenced and published as layers.',
    'point.admin': 'An admin that sets up Google Cloud, Mapbox and USGS with buttons, in your own project, in Romanian and English.',
    'start.action': 'Start your map',
    'start.note': 'Sign in with Google and name your place: the map and its admin are installed in a Google project of your own.',
    'terminal.heading': 'Prefer the terminal?',
    'terminal.text': 'With Node.js and the Firebase and Google Cloud command lines installed, run:',
    'example.heading': 'See an example',
    'example.text': 'The first map made with Historic City Map Maker:',
    'example.link': 'București dispărut (Lost Bucharest)',
    'links.heading': 'Learn more',
    'link.repository': 'Source code',
    'link.setup': 'Setup guide',
    'link.selfHost': 'Self-hosting guide',
    'link.engineApi': 'Engine API',
    'link.releases': 'Releases',
    'link.privacy': 'Privacy policy',
    'link.terms': 'Terms of service',
    'switch.label': 'Language',
    'switch.name': 'Română',
    footer: 'Historic City Map Maker is open source. This page sets no cookie and loads no script.',
};

const RO: LandingCatalogue = {
    title: 'Historic City Map Maker',
    description: 'Fă harta istorică a orașului tău: fotografii vechi, locuri dispărute și hărți de altădată peste harta de azi.',
    lead: 'Historic City Map Maker face harta istorică a oricărui oraș: fotografii vechi, locuri dispărute, povești și hărți de altădată peste harta de azi, cu o administrare care face aproape totul pentru tine.',
    'point.photos':
        'Fotografii vechi așezate acolo unde au fost făcute, fiecare cu direcția în care privea aparatul, lângă locuri și povești.',
    'point.imagery':
        'Imagini istorice (cadre USGS desecretizate, Landsat, hărți scanate de tine) găsite, georeferențiate și publicate ca straturi.',
    'point.admin': 'O administrare care configurează Google Cloud, Mapbox și USGS din butoane, în proiectul tău, în română și engleză.',
    'start.action': 'Pornește-ți harta',
    'start.note': 'Intră cu Google și numește locul: harta și administrarea ei se instalează într-un proiect Google al tău.',
    'terminal.heading': 'Preferi terminalul?',
    'terminal.text': 'Cu Node.js și liniile de comandă Firebase și Google Cloud instalate, rulează:',
    'example.heading': 'Vezi un exemplu',
    'example.text': 'Prima hartă făcută cu Historic City Map Maker:',
    'example.link': 'București dispărut',
    'links.heading': 'Află mai multe',
    'link.repository': 'Codul sursă',
    'link.setup': 'Ghidul de instalare',
    'link.selfHost': 'Ghidul de găzduire proprie',
    'link.engineApi': 'API-ul motorului',
    'link.releases': 'Versiuni',
    'link.privacy': 'Politica de confidențialitate',
    'link.terms': 'Condiții de utilizare',
    'switch.label': 'Limba',
    'switch.name': 'English',
    footer: 'Historic City Map Maker are cod sursă deschis. Această pagină nu pune cookie-uri și nu încarcă scripturi.',
};

export const LANDING_CATALOGUES: Readonly<Record<LandingLanguage, Readonly<Partial<Record<string, string>>>>> = { en: EN, ro: RO };

/** Every key the catalogues lack or leave empty, as `ro: link.terms`; none when both are complete. */
export function missingLandingKeys(catalogues: Readonly<Record<LandingLanguage, Readonly<Partial<Record<string, string>>>>>): string[] {
    return LANDING_LANGUAGES.flatMap((lang) =>
        LANDING_KEYS.filter((key) => (catalogues[lang][key] ?? '').trim() === '').map((key) => `${lang}: ${key}`),
    );
}

/** The complete catalogue of each language; a build error naming every missing or empty key otherwise. */
export function landingCatalogues(
    catalogues: Readonly<Record<LandingLanguage, Readonly<Partial<Record<string, string>>>>>,
): Readonly<Record<LandingLanguage, LandingCatalogue>> {
    const missing = missingLandingKeys(catalogues);
    if (missing.length > 0) {
        throw new SiteBuildError(`the landing page's words are incomplete: ${missing.join(', ')}`);
    }
    return catalogues as Readonly<Record<LandingLanguage, LandingCatalogue>>;
}
