/**
 * M28 (`docs/research/M28-sources.md` §11): the free ways to translate the map's texts, as the Sources step shows them: the
 * quality to expect, the monthly limit, what happens past it, whether sign-up asks for a card, what the provider does with
 * the text, and the sign-up wizard's steps, each with the provider's own page. Every figure was read on the provider's
 * official pages on `TRANSLATION_CHECKED_ON`; a figure a page did not state is `unknown`, never guessed. The texts are
 * `adminSources.tr.<id>.*` (`admin-sources-finder`).
 */

/** The day the figures below were compared with the providers' pages. */
export const TRANSLATION_CHECKED_ON = '2026-11-14';

export const TRANSLATION_OPTIONS = [
    'localModels',
    'deeplFree',
    'googleTranslate',
    'azureTranslator',
    'libreTranslate',
    'myMemory',
] as const;

export type TranslationOption = (typeof TRANSLATION_OPTIONS)[number];

/** The free amount: characters a month, characters a day, or no limit (the owner's own computers). */
export interface FreeLimit {
    readonly per: 'month' | 'day' | 'none';
    readonly characters: number;
}

export interface TranslationFacts {
    readonly id: TranslationOption;
    /** `qa`: translated on the owner's computers and always checked by translating back before use. */
    readonly quality: 'high' | 'good' | 'mixed' | 'qa';
    readonly limit: FreeLimit;
    /** Past the free amount: the service stops until the next period, or bills the card on file. */
    readonly overLimit: 'stops' | 'billed' | 'none' | 'unknown';
    readonly card: 'yes' | 'no' | 'unknown';
    /** `local`: never leaves the computers; `notUsed`: the provider says it does not train on it or store it; `mayStore`: its terms keep it. */
    readonly privacy: 'local' | 'notUsed' | 'mayStore' | 'unknown';
    /** The wizard: one page per step (`null`: a step inside the app or a plain instruction). */
    readonly steps: readonly (string | null)[];
    readonly pricing: string;
}

export const TRANSLATION_CATALOGUE: readonly TranslationFacts[] = [
    {
        id: 'localModels',
        quality: 'qa',
        limit: { per: 'none', characters: 0 },
        overLimit: 'none',
        card: 'no',
        privacy: 'local',
        steps: ['https://ollama.com/download', 'https://ollama.com/library/translategemma', '#/jobs'],
        pricing: 'https://github.com/ollama/ollama',
    },
    {
        id: 'deeplFree',
        quality: 'high',
        limit: { per: 'month', characters: 500_000 },
        overLimit: 'stops',
        card: 'unknown',
        privacy: 'mayStore',
        steps: [
            'https://www.deepl.com/en/signup?cta=checkout&is_api=true&productId=api-developer',
            'https://www.deepl.com/your-account/keys',
            null,
        ],
        pricing: 'https://www.deepl.com/en/pro-api',
    },
    {
        id: 'googleTranslate',
        quality: 'high',
        limit: { per: 'month', characters: 500_000 },
        overLimit: 'billed',
        card: 'yes',
        privacy: 'notUsed',
        steps: [
            'https://console.cloud.google.com/projectselector2/home/dashboard',
            'https://console.cloud.google.com/apis/enableflow?apiid=translate.googleapis.com',
            null,
        ],
        pricing: 'https://cloud.google.com/translate/pricing',
    },
    {
        id: 'azureTranslator',
        quality: 'high',
        limit: { per: 'month', characters: 2_000_000 },
        overLimit: 'stops',
        card: 'yes',
        privacy: 'notUsed',
        steps: [
            'https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account',
            'https://portal.azure.com/#create/Microsoft.CognitiveServicesTextTranslation',
            null,
        ],
        pricing: 'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/',
    },
    {
        id: 'libreTranslate',
        quality: 'mixed',
        limit: { per: 'none', characters: 0 },
        overLimit: 'none',
        card: 'no',
        privacy: 'local',
        steps: ['https://libretranslate.com/', '#/jobs'],
        pricing: 'https://portal.libretranslate.com/',
    },
    {
        id: 'myMemory',
        quality: 'mixed',
        limit: { per: 'day', characters: 50_000 },
        overLimit: 'unknown',
        card: 'no',
        privacy: 'unknown',
        steps: ['https://translated.com/top/sign-up', 'https://mymemory.translated.net/doc/keygen.php', null],
        pricing: 'https://mymemory.translated.net/doc/usagelimits.php',
    },
];
