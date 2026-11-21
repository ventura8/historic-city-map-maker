/**
 * M28 (`docs/research/M28-sources.md` §10): the curated lists `ops.tick` starts a country's `countrySources` document from.
 * Every fact was read on the institution's own pages (or the official fee order) on `factsCheckedOn`; what a page did not
 * say is left out or said to be unpublished, never guessed. `{city}` in a request is the city's name, filled in by the admin.
 */
import { MEANING_PLANS, letter } from './country-seed-parts.js';
import { RO_ARCHIVES } from './country-seed-ro-archives.js';
import type { CountryPlace } from './country-sources.js';

export interface CountrySeed {
    readonly country: string;
    readonly language: string;
    readonly factsCheckedOn: string;
    readonly places: readonly CountryPlace[];
}

const RO_PLACES: readonly CountryPlace[] = [
    ...RO_ARCHIVES,
    {
        id: 'bar',
        name: {
            ro: 'Biblioteca Academiei Române — Cabinetul de Hărți și Cabinetul de Stampe',
            en: 'Romanian Academy Library — Map Cabinet and Print Cabinet',
        },
        kind: 'library',
        access: 'offline',
        cost: 'paid',
        costNote: {
            ro:
                'Permis: 20 lei pe lună, 60 lei pe 6 luni, 100 lei pe an (gratuit pentru elevi și studenți). Scanări făcute de ' +
                'personal: 15 lei (A4), 25 lei (A3), 30 lei (A0) pe imagine; drept de publicare 90 lei pe imagine; fotografii cu ' +
                'telefonul 10 lei pe zi, cel mult 30 de imagini.',
            en:
                'Card: 20 lei a month, 60 lei for 6 months, 100 lei a year (free for pupils and students). Staff scans: 15 lei (A4), 25 ' +
                'lei (A3), 30 lei (A0) an image; publication right 90 lei an image; phone photos 10 lei a day, up to 30 images.',
        },
        materials: ['historicalMaps', 'cityPlans'],
        url: 'https://biblacad.ro/',
        verified: true,
        offline: {
            address: 'Calea Victoriei 125, București',
            hours: {
                ro: 'Luni–joi 8:00–19:00, vineri 8:00–14:00; documentele se aduc între 8:00 și 13:00. Cabinetele au câte 8 locuri.',
                en: 'Monday to Thursday 8:00–19:00, Friday 8:00–14:00; items are brought between 8:00 and 13:00. Each cabinet has 8 seats.',
            },
            phone: '021 212 82 84',
            email: 'relpublic@biblacad.ro',
            access: {
                ro: 'Faceți permisul cu actul de identitate sau pașaportul. Puteți fotografia cu telefonul (10 lei pe zi).',
                en: 'Get the card with your ID or passport. You may take photos with your phone (10 lei a day).',
            },
            request: letter(
                'Consultare hărți în Cabinetul de Hărți — {city}',
                'Aș dori să consult hărțile și planurile vechi ale orașului din Cabinetul de Hărți și stampele cu vederi ale ' +
                    'orașului din Cabinetul de Stampe.',
            ),
            requestMeaning: MEANING_PLANS,
            fees: {
                ro: 'Scanare 15–30 lei pe imagine, plus 90 lei pe imagine pentru dreptul de publicare; fotografii proprii 10 lei pe zi.',
                en: 'Scans 15–30 lei an image, plus 90 lei an image for the right to publish; your own photos 10 lei a day.',
            },
            importRoute: 'localImport',
        },
    },
    {
        id: 'mmb',
        name: {
            ro: 'Muzeul Municipiului București — colecția Hărți și Planuri',
            en: 'Bucharest Municipal Museum — Maps and Plans collection',
        },
        kind: 'museum',
        access: 'offline',
        cost: 'unknown',
        years: { from: 1500, to: 1999 },
        materials: ['cityPlans', 'historicalMaps'],
        holdings: {
            ro:
                '1.336 de piese (467 de hărți, 869 de planuri), secolele XVI–XX. Cereți pe nume: planul Borroczyn (1852), Pappazoglu ' +
                '(1871), Hiotu (1871), Pântea (1921).',
            en:
                '1,336 items (467 maps, 869 plans), 16th–20th century. Ask by name: the Borroczyn plan (1852), Pappazoglu (1871), Hiotu ' +
                '(1871), Pântea (1921).',
        },
        url: 'https://muzeulbucurestiului.ro/en/the-maps-and-plans-collection/',
        verified: true,
        offline: {
            address: 'Palatul Suțu, Bulevardul I.C. Brătianu 2, București',
            hours: {
                ro: 'Programul pentru cercetători nu este publicat: scrieți sau sunați înainte.',
                en: 'Hours for researchers are not published: write or call first.',
            },
            phone: '021 315 68 58',
            email: 'mmb@muzeulbucurestiului.ro',
            access: {
                ro: 'Muzeul nu publică regulile de acces pentru cercetare; scrisoarea le cere.',
                en: 'The museum publishes no research access rules; the letter asks for them.',
            },
            request: letter(
                'Cerere de consultare a planurilor Bucureștilor — {city}',
                'Aș dori să consult și să obțin copii ale planurilor Borroczyn (1852), Pappazoglu (1871), Hiotu (1871) și Pântea ' +
                    '(1921) din colecția Hărți și Planuri.',
            ),
            requestMeaning: MEANING_PLANS,
            fees: { ro: 'Nepublicate; muzeul le comunică.', en: 'Not published; the museum states them.' },
            importRoute: 'localImport',
        },
    },
    {
        id: 'copernicus',
        name: { ro: 'Copernicus Data Space Ecosystem', en: 'Copernicus Data Space Ecosystem' },
        kind: 'portal',
        access: 'online',
        cost: 'free',
        costNote: {
            ro: 'Gratuit, cu un cont. Cotele gratuite se resetează la începutul fiecărei luni.',
            en: 'Free, with an account. The free quotas reset at the start of every month.',
        },
        materials: ['satellite'],
        url: 'https://dataspace.copernicus.eu/',
        verified: true,
        online: {
            signupUrl: 'https://browser.dataspace.copernicus.eu/',
            key: 'site',
            howTo: {
                ro:
                    'Faceți-vă un cont gratuit, deschideți browserul Copernicus, căutați orașul și o zi fără nori, apoi descărcați ' +
                    'imaginea. Harta folosește deja Sentinel-2 singură pentru aliniere, fără cont.',
                en:
                    'Make a free account, open the Copernicus Browser, find the city and a cloud-free day, then download the image. The ' +
                    'map already uses Sentinel-2 on its own for alignment, with no account.',
            },
            importRoute: 'imageryUpload',
        },
    },
    {
        id: 'skywatch',
        name: { ro: 'SkyWatch (imagini satelitare comerciale)', en: 'SkyWatch (commercial satellite images)' },
        kind: 'commercial',
        access: 'online',
        cost: 'paid',
        costNote: {
            ro:
                'Prețuri de pornire pe km², din arhivă: 25 USD (15 cm), 19 USD (30–49 cm), 10 USD (50–99 cm), 2,5 USD (1–8 m); minimum ' +
                '1 km².',
            en:
                'Starting prices a km², from the archive: USD 25 (15 cm), USD 19 (30–49 cm), USD 10 (50–99 cm), USD 2.5 (1–8 m); at ' +
                'least 1 km².',
        },
        materials: ['satellite'],
        url: 'https://skywatch.com/data',
        verified: true,
        online: {
            signupUrl: 'https://explore.skywatch.com/',
            key: 'site',
            howTo: {
                ro:
                    'Faceți-vă un cont gratuit în SkyWatch Explore, desenați zona orașului, alegeți o imagine din arhivă și plătiți-o ' +
                    'acolo; apoi descărcați fișierul.',
                en:
                    'Make a free SkyWatch Explore account, draw the city’s area, choose an archive image and pay for it there; then ' +
                    'download the file.',
            },
            importRoute: 'imageryUpload',
        },
    },
    {
        id: 'arcanum',
        name: { ro: 'Arcanum Maps (hărți militare habsburgice)', en: 'Arcanum Maps (Habsburg military surveys)' },
        kind: 'commercial',
        access: 'online',
        cost: 'paid',
        costNote: {
            ro:
                'Accesul complet la hărți cere un abonament (pagina Arcanum); prețul este pe site-ul lor. Publicarea pe harta publică ' +
                'cere licența lor scrisă.',
            en:
                'Full access to the maps needs a subscription (Arcanum’s page); the price is on their site. Putting them on the public ' +
                'map needs their written licence.',
        },
        materials: ['historicalMaps'],
        holdings: {
            ro: '„Țara Românească – a doua ridicare militară a Imperiului Habsburgic”.',
            en: '“Wallachia – Second military survey of the Habsburg Empire”.',
        },
        url: 'https://maps.arcanum.com/',
        verified: true,
        online: {
            key: 'none',
            howTo: {
                ro:
                    'Priviți hărțile gratuit pe site; pentru imagini întregi faceți abonamentul acolo și cereți licența scrisă înainte ' +
                    'să le puneți pe hartă.',
                en:
                    'Look at the maps free on the site; for whole images subscribe there and ask for the written licence before putting ' +
                    'them on the map.',
            },
            importRoute: 'imageryUpload',
        },
    },
];

/** The countries with a curated list, by ISO code. */
export const COUNTRY_SEEDS: Readonly<Record<string, CountrySeed>> = {
    RO: { country: 'RO', language: 'ro', factsCheckedOn: '2026-11-14', places: RO_PLACES },
};
