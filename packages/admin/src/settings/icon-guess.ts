/**
 * The icon a new category's label suggests (behaviour A39, minimum admin input): until the admin picks an icon, a new
 * category's icon follows the words of its label in Romanian or English ("Biserici" a church, "Fântâni" water), so the
 * common case needs no click in the picker. The label is compared without diacritics and case; the first entry whose
 * pattern matches wins, the specific kinds of place before the generic ones (a demolished church is still a church). A
 * label with no known word keeps `DEFAULT_POI_ICON`, the pin.
 */
import { DEFAULT_POI_ICON, type PoiIcon } from '@hcm/shared';

/**
 * Each icon with the words that name it: `biseric*` is any word that starts so (biserica, bisericile), `gara` only that
 * word (a short stem would also match garaj).
 */
const ICON_WORDS: readonly (readonly [PoiIcon, readonly string[]])[] = [
    ['church', ['biseric*', 'manastir*', 'catedral*', 'schit*', 'capel*', 'church*', 'monaster*', 'cathedral*', 'chapel*']],
    ['mosque', ['geamie', 'geamii', 'moschee*', 'mosque*']],
    ['synagogue', ['sinagog*', 'synagog*']],
    ['museum', ['muze*', 'museum*']],
    ['theater_comedy', ['teatr*', 'theat*', 'cinema*', 'opera', 'circ', 'circus']],
    ['school', ['scoal*', 'scoli*', 'licee*', 'liceu*', 'colegi*', 'universit*', 'facultat*', 'school*', 'college*', 'academ*']],
    ['local_hospital', ['spital*', 'hospital*', 'clinic*', 'sanator*', 'maternit*']],
    ['train', ['gara', 'gari', 'garile', 'tren*', 'feroviar*', 'railway*', 'train*']],
    ['tram', ['tramv*', 'tram', 'trams']],
    [
        'water',
        ['fantan*', 'izvor*', 'lac', 'lacul', 'lacuri', 'apa', 'ape', 'rau', 'raul', 'fountain*', 'water*', 'lake', 'lakes', 'river*'],
    ],
    ['park', ['parc', 'parcul', 'parcuri', 'park', 'parks', 'gradin*', 'garden*']],
    ['store', ['magazin*', 'pravali*', 'bacani*', 'comert*', 'hala', 'hale', 'halele', 'shop*', 'store*', 'market*']],
    ['factory', ['fabric*', 'uzin*', 'industr*', 'factory', 'factories', 'moar*', 'mill', 'mills']],
    ['castle', ['castel*', 'palat*', 'conac*', 'castle*', 'palace*', 'manor*']],
    ['fort', ['cetat*', 'fort*', 'citadel*', 'bastion*']],
    ['stadium', ['stadion*', 'stadium*', 'arena*', 'sport*']],
    ['flag', ['ambasad*', 'embass*', 'consul*', 'steag*', 'flag*']],
    [
        'account_balance',
        [
            'banca',
            'banci',
            'bancile',
            'bank*',
            'minister*',
            'tribunal*',
            'guvern*',
            'primari*',
            'parlament*',
            'monument*',
            'statui*',
            'statue*',
        ],
    ],
    ['apartment', ['bloc', 'blocuri', 'blocurile', 'apartament*', 'apartment*']],
    ['home', ['casa', 'case', 'casele', 'locuint*', 'vila', 'vile', 'vilele', 'house*', 'home*', 'villa*']],
    ['add_road', ['strad*', 'bulevard*', 'sosea*', 'sosele*', 'drum*', 'road*', 'street*', 'boulevard*', 'avenue*']],
    ['route', ['traseu*', 'trasee*', 'itinerar*', 'route*', 'tour', 'tours', 'walk', 'walks']],
    ['construction', ['santier*', 'construct*', 'lucrari*']],
    ['domain_disabled', ['demol*', 'disparu*', 'ruin*', 'lost']],
    ['domain', ['cladir*', 'edifici*', 'building*']],
    ['history', ['istori*', 'histor*', 'memori*', 'comemor*']],
    ['event', ['eveniment*', 'event*', 'cutremur*', 'earthquake*', 'bombard*', 'revolut*']],
    ['photo_camera', ['foto*', 'photo*']],
    ['info', ['info*']],
];

/** The label's words in lower case without diacritics (ș, ț, ă, â and î become s, t, a, a and i). */
function wordsOf(text: string): string[] {
    return text
        .normalize('NFD')
        .replaceAll(/\p{M}/gu, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
}

/** Whether `word` is named by `pattern` (a whole word, or a start with `*`). */
function names(pattern: string, word: string): boolean {
    return pattern.endsWith('*') ? word.startsWith(pattern.slice(0, -1)) : word === pattern;
}

/** The icon the label's words name, else the pin. */
export function guessCategoryIcon(label: { readonly ro: string; readonly en?: string | undefined }): string {
    const words = wordsOf(`${label.ro} ${label.en ?? ''}`);
    const found = ICON_WORDS.find(([, patterns]) => patterns.some((pattern) => words.some((word) => names(pattern, word))));
    return found?.[0] ?? DEFAULT_POI_ICON;
}
