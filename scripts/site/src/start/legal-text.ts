/**
 * The words of the start site's privacy policy and terms (`docs/research/M14-start-your-map.md` §10, Google's OAuth
 * verification), Romanian and English. They describe what `packages/admin/src/start/` does: change one with the other.
 */

/** A link inside a paragraph. */
interface LegalLink {
    readonly href: string;
    readonly text: string;
}

/** A paragraph or list item: text, with links where they belong. */
export type LegalText = string | readonly (string | LegalLink)[];

export interface LegalSection {
    readonly heading: string;
    readonly paragraphs: readonly LegalText[];
    readonly items?: readonly LegalText[];
}

export interface LegalLanguage {
    readonly title: string;
    readonly updated: string;
    readonly intro: LegalText;
    readonly sections: readonly LegalSection[];
}

export interface LegalPage {
    readonly file: string;
    readonly description: string;
    readonly ro: LegalLanguage;
    readonly en: LegalLanguage;
}

/** The day the words last changed. */
const LEGAL_UPDATED = '2026-11-09';
const START_SITE_ORIGIN = 'https://start-historic-city.web.app';
const ISSUES_URL = 'https://github.com/ventura8/historic-city-map-maker/issues';
export const SOURCE_URL = 'https://github.com/ventura8/historic-city-map-maker';
export const PERMISSIONS_URL = 'https://myaccount.google.com/permissions';
export const USER_DATA_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy';
export const PRIVACY_FILE = 'privacy.html';
export const TERMS_FILE = 'terms.html';

const SCOPE_PROJECTS = 'https://www.googleapis.com/auth/cloudplatformprojects';
const SCOPE_FIREBASE = 'https://www.googleapis.com/auth/firebase';
const issues: LegalLink = { href: ISSUES_URL, text: ISSUES_URL };
const permissions: LegalLink = { href: PERMISSIONS_URL, text: PERMISSIONS_URL };
const userDataPolicy = { href: USER_DATA_POLICY_URL };

export const PRIVACY_PAGE: LegalPage = {
    file: PRIVACY_FILE,
    description: 'Politica de confidențialitate a paginii de pornire. Privacy policy of the start page.',
    ro: {
        title: 'Politica de confidențialitate',
        updated: `Ultima actualizare: ${LEGAL_UPDATED}`,
        intro: [
            'Această politică privește pagina de pornire a Historic City Map Maker, ',
            { href: START_SITE_ORIGIN, text: START_SITE_ORIGIN },
            ' („pagina”). Historic City Map Maker este un proiect cu sursă deschisă; pagina creează o hartă istorică a unui oraș într-un proiect Google al tău.',
        ],
        sections: [
            {
                heading: 'Ce cere pagina de la Google',
                paragraphs: ['Când apeși Continuă cu Google, Google îți cere două permisiuni:'],
                items: [
                    `${SCOPE_PROJECTS}: să îți listeze proiectele Google Cloud, ca să alegi unul, și să creeze proiectul nou pe care îl numești.`,
                    `${SCOPE_FIREBASE}: să adauge Firebase în acel proiect, să îi creeze aplicația web și site-ul Hosting, să verifice dacă autentificarea cu Google este pornită pentru administrare și să încarce și să publice fișierele hărții pe Firebase Hosting, în acel proiect.`,
                ],
            },
            {
                heading: 'Ce nu cere',
                paragraphs: [
                    'Pagina nu cere profilul, adresa de e-mail, contactele sau alte date Google și folosește permisiunile doar pentru pașii de mai sus, doar cât ești pe pagină.',
                ],
            },
            {
                heading: 'Tokenul Google',
                paragraphs: [
                    'Google trimite un token de acces acestei file. Pagina îl ține doar în memoria filei, cel mult o oră, îl scoate imediat din adresă, nu îl salvează nicăieri și nu îl trimite niciodată unui server al nostru: merge doar la API-urile Google (cloudresourcemanager, firebase, firebasehosting și identitytoolkit, pe googleapis.com), singurele pe care politica de securitate a paginii le permite.',
                ],
            },
            {
                heading: 'Ce păstrează pagina în browser',
                paragraphs: [
                    'sessionStorage al filei ține planul introdus (numele și identificatorul orașului, dreptunghiul lui, proiectul ales) și o valoare aleatorie care verifică că răspunsul Google era pentru această filă, ca o reîncărcare să nu piardă nimic. Se șterge când închizi fila. Pagina nu pune cookie-uri și nu are cod de analiză, reclame sau urmărire.',
                ],
            },
            {
                heading: 'Unde ajung datele',
                paragraphs: [
                    'Tot ce creează pagina (proiectul, aplicația Firebase, site-ul Hosting și fișierele hărții, cu orașul introdus) este în proiectul tău Google, sub contul tău. Noi nu avem acces la el. Îl poți schimba sau șterge oricând din consola Google Cloud.',
                    'Nu avem niciun server pentru această pagină și nu primim date Google ale tale. Pagina este un site static pe Firebase Hosting; Google, ca gazdă, procesează cererile după propria politică de confidențialitate.',
                ],
            },
            {
                heading: 'Politica Google pentru datele utilizatorilor',
                paragraphs: [
                    [
                        'Folosirea informațiilor primite de la API-urile Google respectă ',
                        { ...userDataPolicy, text: 'Google API Services User Data Policy' },
                        ', inclusiv cerințele Limited Use. Datele de la Google servesc doar ce ceri pe pagină, nu sunt transferate nimănui, nu sunt folosite pentru reclame și nu sunt citite de oameni.',
                    ],
                ],
            },
            {
                heading: 'Cum retragi accesul',
                paragraphs: [['Tokenul expiră singur în cel mult o oră. Poți retrage oricând accesul paginii la ', permissions, '.']],
            },
            {
                heading: 'Schimbări și contact',
                paragraphs: [['Schimbările apar pe această pagină, cu o dată nouă. Întrebări: ', issues, '.']],
            },
        ],
    },
    en: {
        title: 'Privacy policy',
        updated: `Last updated: ${LEGAL_UPDATED}`,
        intro: [
            'This policy covers the start page of Historic City Map Maker, ',
            { href: START_SITE_ORIGIN, text: START_SITE_ORIGIN },
            ' ("the page"). Historic City Map Maker is an open-source project; the page creates a historical map of a city in a Google project of your own.',
        ],
        sections: [
            {
                heading: 'What the page asks Google for',
                paragraphs: ['When you press Continue with Google, Google asks you for two permissions:'],
                items: [
                    `${SCOPE_PROJECTS}: to list your Google Cloud projects, so you can pick one, and to create the new project you name.`,
                    `${SCOPE_FIREBASE}: to add Firebase to that project, create its web app and its Hosting site, check whether Google sign-in is on for the admin, and upload and publish the map's files to Firebase Hosting in that project.`,
                ],
            },
            {
                heading: 'What it does not ask for',
                paragraphs: [
                    'The page asks for no profile, email address, contacts or any other Google data, and uses the permissions only for the steps above, only while you are on the page.',
                ],
            },
            {
                heading: 'Your Google token',
                paragraphs: [
                    "Google returns an access token to this tab. The page keeps it only in the tab's memory, for at most an hour, removes it from the address at once, stores it nowhere and never sends it to a server of ours: it goes only to Google's APIs (cloudresourcemanager, firebase, firebasehosting and identitytoolkit, on googleapis.com), the only ones the page's security policy allows.",
                ],
            },
            {
                heading: 'What the page keeps in your browser',
                paragraphs: [
                    "The tab's sessionStorage holds the plan you entered (the city's name and id, its rectangle, the project you chose) and a random value that checks Google's answer was meant for this tab, so a reload loses nothing. It is deleted when you close the tab. The page sets no cookies and has no analytics, advertising or tracking code.",
                ],
            },
            {
                heading: 'Where the data ends up',
                paragraphs: [
                    "Everything the page creates (the project, the Firebase app, the Hosting site and the map's files, with the city you entered) is in your own Google project, under your account. We have no access to it. You can change or delete it at any time in the Google Cloud console.",
                    'We run no server for this page and receive none of your Google data. The page is a static site on Firebase Hosting; Google, as the host, processes the requests under its own privacy policy.',
                ],
            },
            {
                heading: "Google's user data policy",
                paragraphs: [
                    [
                        "The page's use of information received from Google APIs adheres to the ",
                        { ...userDataPolicy, text: 'Google API Services User Data Policy' },
                        ', including the Limited Use requirements. Data from Google serves only what you ask on the page, is transferred to no one, is not used for advertising and is not read by humans.',
                    ],
                ],
            },
            {
                heading: 'How to revoke access',
                paragraphs: [
                    ["The token expires by itself within an hour. You can remove the page's access at any time at ", permissions, '.'],
                ],
            },
            {
                heading: 'Changes and contact',
                paragraphs: [['Changes appear on this page with a new date. Questions: ', issues, '.']],
            },
        ],
    },
};

export const TERMS_PAGE: LegalPage = {
    file: TERMS_FILE,
    description: 'Condițiile de utilizare ale paginii de pornire. Terms of service of the start page.',
    ro: {
        title: 'Condiții de utilizare',
        updated: `Ultima actualizare: ${LEGAL_UPDATED}`,
        intro: 'Aceste condiții privesc pagina de pornire a Historic City Map Maker. Folosind pagina, le accepți.',
        sections: [
            {
                heading: 'Serviciul',
                paragraphs: [
                    [
                        'Pagina este gratuită și are sursa deschisă (',
                        { href: SOURCE_URL, text: SOURCE_URL },
                        '). Creează o hartă istorică în proiectul tău Google; nu ai nevoie de un cont la noi.',
                    ],
                ],
            },
            {
                heading: 'Fără garanție',
                paragraphs: [
                    'Pagina și aplicațiile pe care le publică sunt oferite „ca atare”, fără nicio garanție, expresă sau implicită, inclusiv de potrivire pentru un anumit scop. În măsura permisă de lege, autorii nu răspund pentru nicio pagubă sau cost care vine din folosirea lor.',
                ],
            },
            {
                heading: 'Conturile și costurile tale',
                paragraphs: [
                    'Răspunzi de conturile tale Google Cloud, Firebase și Mapbox, de condițiile lor și de orice factură pe care o emit, inclusiv planul Blaze și folosirea peste nivelurile gratuite. Bugetul pe care îl setează administrarea este un ajutor, nu o garanție.',
                ],
            },
            {
                heading: 'Conținutul tău',
                paragraphs: [
                    'Răspunzi de ce publici pe harta ta și trebuie să ai dreptul să publici fotografiile, textele și imaginile ei.',
                ],
            },
            {
                heading: 'Servicii terțe',
                paragraphs: ['Serviciile Google și Mapbox au propriile condiții, care se aplică atunci când le folosești.'],
            },
            {
                heading: 'Schimbări și contact',
                paragraphs: [['Schimbările apar pe această pagină, cu o dată nouă. Întrebări: ', issues, '.']],
            },
        ],
    },
    en: {
        title: 'Terms of service',
        updated: `Last updated: ${LEGAL_UPDATED}`,
        intro: 'These terms cover the start page of Historic City Map Maker. By using the page, you accept them.',
        sections: [
            {
                heading: 'The service',
                paragraphs: [
                    [
                        'The page is free and open source (',
                        { href: SOURCE_URL, text: SOURCE_URL },
                        '). It creates a historical map in your own Google project; you need no account with us.',
                    ],
                ],
            },
            {
                heading: 'No warranty',
                paragraphs: [
                    'The page and the apps it publishes are provided "as is", without warranty of any kind, express or implied, including fitness for a particular purpose. To the extent the law allows, the authors are not liable for any damage or cost arising from their use.',
                ],
            },
            {
                heading: 'Your accounts and costs',
                paragraphs: [
                    'You are responsible for your Google Cloud, Firebase and Mapbox accounts, their terms and any bill they charge, including the Blaze plan and use beyond the free tiers. The budget the admin sets is a help, not a guarantee.',
                ],
            },
            {
                heading: 'Your content',
                paragraphs: [
                    'You are responsible for what you publish on your map and must have the right to publish its photos, texts and imagery.',
                ],
            },
            {
                heading: 'Third-party services',
                paragraphs: ["Google's and Mapbox's services have their own terms, which apply when you use them."],
            },
            {
                heading: 'Changes and contact',
                paragraphs: [['Changes appear on this page with a new date. Questions: ', issues, '.']],
            },
        ],
    },
};
