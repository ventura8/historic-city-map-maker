/**
 * M28 (`docs/research/M28-sources.md` §2): what each source of the **Sources** step is, as data: its group, the account it
 * needs, how many pros, cons and how-to steps its texts have (`@hcm/shared/admin-sources`), the provider's official pages,
 * and its monthly cost estimate. Every figure is one the product already uses (the Blaze line of Setup's billing card, the
 * AI drafts' monthly cap, USGS's scan price); a cost the product has no figure for links the provider's pricing page instead.
 */
import { AI_MONTHLY_CAP } from './assist.js';
import { ONE_SCAN_USD, PLATFORM_MONTHLY_USD, type UsdRange } from './platform-costs.js';
import { REQUIRED_SOURCES, SOURCE_TOGGLES, type SourceChoices, type SourceId, type SourceToggle } from './sources.js';

export { ONE_SCAN_USD, PLATFORM_MONTHLY_USD, type UsdRange } from './platform-costs.js';

/** The day the figures and links below were last compared with the providers' pages. */
export const SOURCES_CHECKED_ON = '2026-11-13';

export type SourceGroup = 'imagery' | 'places' | 'ai';

/** The account a source needs; the Setup step that holds it says whether it exists. */
export type SourceAccount = 'usgs' | 'google';

export interface SourceLink {
    readonly kind: 'pricing' | 'licence' | 'policy' | 'site';
    readonly url: string;
}

export interface SourceFacts {
    readonly id: SourceId;
    readonly group: SourceGroup;
    readonly required: boolean;
    readonly account: SourceAccount | null;
    /** The source this one only works with (paid scans need the declassified imagery). */
    readonly needs: SourceToggle | null;
    /** How many `pro.N`, `con.N` and `step.N` texts it has (`adminSources.<id>.pro.1` …). */
    readonly pros: number;
    readonly cons: number;
    readonly steps: number;
    readonly links: readonly SourceLink[];
    /** What it adds to the month's bill (an estimate); zero for the free sources. */
    readonly monthlyUsd: UsdRange;
}

const FREE: UsdRange = { low: 0, high: 0 };

const PRICING = {
    vertex: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
} as const;

const EARTH_EXPLORER: SourceLink = { kind: 'site', url: 'https://earthexplorer.usgs.gov/' };

function facts(id: SourceId, group: SourceGroup, rest: Partial<Omit<SourceFacts, 'id' | 'group' | 'required'>>): SourceFacts {
    return {
        id,
        group,
        required: (REQUIRED_SOURCES as readonly string[]).includes(id),
        account: null,
        needs: null,
        pros: 2,
        cons: 2,
        steps: 0,
        links: [],
        monthlyUsd: FREE,
        ...rest,
    };
}

/** Every source in the step's order: the imagery, then places and streets, then the AI. */
export const SOURCE_CATALOGUE: readonly SourceFacts[] = [
    facts('usgs', 'imagery', { account: 'usgs', pros: 3, cons: 3, steps: 3, links: [EARTH_EXPLORER] }),
    facts('usgsOrders', 'imagery', { account: 'usgs', needs: 'usgs', steps: 3, links: [EARTH_EXPLORER] }),
    facts('landsat', 'imagery', { account: 'usgs', steps: 1, links: [EARTH_EXPLORER] }),
    facts('sentinel2', 'imagery', {}),
    facts('archives', 'imagery', { steps: 2 }),
    facts('contributors', 'places', { steps: 2 }),
    facts('openData', 'places', {
        links: [
            { kind: 'licence', url: 'https://www.openstreetmap.org/copyright' },
            { kind: 'licence', url: 'https://www.openhistoricalmap.org/copyright' },
            { kind: 'licence', url: 'https://www.wikidata.org/wiki/Wikidata:Licensing' },
            { kind: 'policy', url: 'https://operations.osmfoundation.org/policies/nominatim/' },
        ],
    }),
    facts('localAi', 'ai', { steps: 1 }),
    facts('cloudAi', 'ai', {
        account: 'google',
        links: [{ kind: 'pricing', url: PRICING.vertex }],
        monthlyUsd: { low: 0, high: AI_MONTHLY_CAP.usd },
    }),
];

const BY_ID = Object.fromEntries(SOURCE_CATALOGUE.map((entry) => [entry.id, entry])) as Readonly<Record<SourceId, SourceFacts>>;

/** The catalogue entry of `id` (every id has one: the catalogue test lists them all). */
export function sourceFacts(id: SourceId): SourceFacts {
    return BY_ID[id];
}

/** Whether `id` is on in `choices` (a required source always is). */
export function sourceOn(choices: SourceChoices, id: SourceId): boolean {
    return (SOURCE_TOGGLES as readonly string[]).includes(id) ? choices[id as SourceToggle] : true;
}

/**
 * M28 (the owner, 2026-11-13): collections to draw from by hand. None is collected automatically: the admin or a helper
 * checks an item's licence (or asks its author), then brings it in through a path the product has: Photos (a photo with its
 * author, licence and source), Imagery → Upload (a map), or Contribute (a helper's photo, reviewed). No switch: nothing runs
 * on its own, so there is nothing to turn on; an automatic import is named `planned` until one is built.
 */
export const GUIDED_SOURCES = [
    'facebook',
    'nara',
    'commons',
    'europeana',
    'fortepan',
    'romanianArchives',
    'rumsey',
    'loc',
    'oldMapsOnline',
    'mapillary',
    'arcanum',
] as const;

export type GuidedSource = (typeof GUIDED_SOURCES)[number];

/** Whether its material may go on the public map: always, item by item (its licence), or only with a written permission. */
export type PublicUse = 'yes' | 'perItem' | 'permission';

/** Where an item comes in today: the photo editor, Imagery → Upload (a map), either, or a finder that leads to the holder. */
export type ImportPath = 'photos' | 'imageryUpload' | 'photosOrUpload' | 'finder';

export interface GuidedFacts {
    readonly id: GuidedSource;
    readonly publicUse: PublicUse;
    readonly path: ImportPath;
    /** An automatic import through the holder's official interface: `planned` (not built), or none possible. */
    readonly automatic: 'planned' | 'none';
    readonly links: readonly SourceLink[];
}

type GuidedHow = Pick<GuidedFacts, 'publicUse' | 'path' | 'automatic'>;

function guided(id: GuidedSource, how: GuidedHow, ...urls: string[]): GuidedFacts {
    return { id, ...how, links: urls.map((url) => ({ kind: 'site', url })) };
}

export const GUIDED_CATALOGUE: readonly GuidedFacts[] = [
    guided(
        'facebook',
        { publicUse: 'permission', path: 'photos', automatic: 'none' },
        'https://www.facebook.com/apps/site_scraping_tos_terms.php',
    ),
    guided(
        'nara',
        // Air photos are photos of the kind `aerial`, never map layers (the owner, 2026-11-16).
        { publicUse: 'perItem', path: 'photos', automatic: 'none' },
        'https://www.archives.gov/research/cartographic/aerial-photography/rg-373-gx-foreign-aerial-photography',
        'https://ncap.org.uk/NARA',
    ),
    guided('commons', { publicUse: 'perItem', path: 'photosOrUpload', automatic: 'planned' }, 'https://commons.wikimedia.org/'),
    guided('europeana', { publicUse: 'perItem', path: 'photosOrUpload', automatic: 'planned' }, 'https://www.europeana.eu/'),
    guided('fortepan', { publicUse: 'yes', path: 'photos', automatic: 'planned' }, 'https://fortepan.hu/en/'),
    guided(
        'romanianArchives',
        { publicUse: 'permission', path: 'photosOrUpload', automatic: 'none' },
        'https://bibnat.ro/',
        'https://arhivelenationale.ro/',
    ),
    guided('rumsey', { publicUse: 'perItem', path: 'imageryUpload', automatic: 'planned' }, 'https://www.davidrumsey.com/'),
    guided('loc', { publicUse: 'perItem', path: 'photosOrUpload', automatic: 'planned' }, 'https://www.loc.gov/'),
    guided('oldMapsOnline', { publicUse: 'perItem', path: 'finder', automatic: 'none' }, 'https://www.oldmapsonline.org/'),
    guided('mapillary', { publicUse: 'yes', path: 'photos', automatic: 'planned' }, 'https://www.mapillary.com/'),
    guided('arcanum', { publicUse: 'permission', path: 'imageryUpload', automatic: 'none' }, 'https://maps.arcanum.com/'),
];

/** What the step lists as not usable, each with why (`adminSources.notUsable.<id>`). */
export const NOT_USABLE_SOURCES = ['facebookScraping', 'otherMapSites', 'googleImagery', 'mapboxSatellite', 'unknownWeb'] as const;

export type NotUsableSource = (typeof NOT_USABLE_SOURCES)[number];

/**
 * M28 (the owner, 2026-11-13): the app's platform, one Setup card in five sections, each with its official price pages. Not a
 * source: always on, each part set up by its own step (billing, Prepare the project, Install the server, Mapbox).
 */
export const PLATFORM_SECTIONS = ['googleCloud', 'firebase', 'firestore', 'cloudServices', 'mapbox'] as const;

export type PlatformSection = (typeof PLATFORM_SECTIONS)[number];

const FIREBASE_PRICING: SourceLink = { kind: 'pricing', url: 'https://firebase.google.com/pricing' };

export const PLATFORM_LINKS: Readonly<Record<PlatformSection, readonly SourceLink[]>> = {
    googleCloud: [{ kind: 'pricing', url: 'https://firebase.google.com/docs/projects/billing/firebase-pricing-plans' }],
    firebase: [FIREBASE_PRICING],
    firestore: [FIREBASE_PRICING],
    cloudServices: [
        { kind: 'pricing', url: 'https://cloud.google.com/storage/pricing' },
        { kind: 'pricing', url: 'https://cloud.google.com/run/pricing' },
        { kind: 'pricing', url: 'https://cloud.google.com/build/pricing' },
        { kind: 'pricing', url: 'https://cloud.google.com/artifact-registry/pricing' },
        { kind: 'pricing', url: 'https://cloud.google.com/secret-manager/pricing' },
    ],
    mapbox: [{ kind: 'pricing', url: 'https://www.mapbox.com/pricing' }],
};

/**
 * The chosen set's month: the platform's fixed line, the sum of each chosen source's estimate, both together, and whether a paid
 * scan may come on top (one-off).
 */
export interface SourcesEstimate {
    readonly platform: UsdRange;
    readonly sources: UsdRange;
    readonly monthly: UsdRange;
    /** One frame scanned on demand, when paid scans are chosen (bought one by one, never monthly); else null. */
    readonly perScanUsd: number | null;
}

export function sourcesEstimate(choices: SourceChoices): SourcesEstimate {
    const chosen = SOURCE_CATALOGUE.filter((entry) => sourceOn(choices, entry.id));
    const round = (value: number): number => Math.round(value * 100) / 100;
    const sources = {
        low: round(chosen.reduce((sum, entry) => sum + entry.monthlyUsd.low, 0)),
        high: round(chosen.reduce((sum, entry) => sum + entry.monthlyUsd.high, 0)),
    };
    return {
        platform: PLATFORM_MONTHLY_USD,
        sources,
        monthly: { low: round(PLATFORM_MONTHLY_USD.low + sources.low), high: round(PLATFORM_MONTHLY_USD.high + sources.high) },
        perScanUsd: choices.usgsOrders ? ONE_SCAN_USD : null,
    };
}
