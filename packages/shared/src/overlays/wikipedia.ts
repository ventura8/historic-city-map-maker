/**
 * The Wikipedia overlay's articles as the viewer draws them (`docs/research/M31-wikipedia.md` §4): each article becomes a
 * point of interest of the overlay's category (`WIKIPEDIA_CATEGORY_ID`), so the map, its switch and slider in Layers, the
 * click and the detail sheet are the places' own. The title and extract are the visitor's language's when the article has
 * one (Romanian or English), else the other's; the extract is escaped for the Markdown subset, so it stays plain text; one
 * link, **Read on Wikipedia**, goes to the version shown. No years: the overlay never follows the timeline.
 */
import { translate, type ViewerLocale } from '../i18n/index.js';
import type { Poi } from '../schemas/poi.js';
import type { WikipediaArticle, WikipediaLanguage, WikipediaVersion } from '../schemas/wikipedia.js';
import { WIKIPEDIA_CATEGORY_ID } from '../schemas/wikipedia.js';

/** The ids of the articles' POIs (`wikipedia-<article id>`): one namespace with the city's own places, never a clash. */
export function wikipediaPoiId(articleId: string): string {
    return `${WIKIPEDIA_CATEGORY_ID}-${articleId}`;
}

/** The language of the version shown: the visitor's when the article has it, else the other one. */
export function shownWikipediaLanguage(article: WikipediaArticle, locale: ViewerLocale): WikipediaLanguage {
    const first: WikipediaLanguage = locale === 'en' ? 'en' : 'ro';
    const other: WikipediaLanguage = first === 'en' ? 'ro' : 'en';
    return article.versions[first] === undefined ? other : first;
}

function shownVersion(article: WikipediaArticle, locale: ViewerLocale): WikipediaVersion {
    const version = article.versions[shownWikipediaLanguage(article, locale)];
    // The schema refuses an article with neither version.
    return version ?? { title: article.id, extract: '', url: 'https://ro.wikipedia.org/wiki/' };
}

/** Text the Markdown subset shows as it is: its markers and the backslash made literal. */
export function literalMarkdown(text: string): string {
    return text.replaceAll(/[\\*_[\]()]/g, (character) => `\\${character}`);
}

/** One article as a place of the overlay's category, in `locale`. */
export function wikipediaPoi(article: WikipediaArticle, locale: ViewerLocale): Poi {
    const version = shownVersion(article, locale);
    const extract = literalMarkdown(version.extract.trim());
    return {
        id: wikipediaPoiId(article.id),
        category: WIKIPEDIA_CATEGORY_ID,
        geometry: { type: 'Point', coordinates: [article.lng, article.lat] },
        title: { ro: version.title, en: version.title },
        ...(extract === '' ? {} : { description: { ro: extract, en: extract } }),
        links: [{ url: version.url, label: translate(locale, 'wikipedia.read') }],
    };
}

/** Every article as a place, in `locale`. */
export function wikipediaPois(articles: readonly WikipediaArticle[], locale: ViewerLocale): readonly Poi[] {
    return articles.map((article) => wikipediaPoi(article, locale));
}

/** The article behind a POI id, or undefined (a city's own place, an unknown id). */
export function wikipediaArticleOf(articles: readonly WikipediaArticle[], poiId: string | null): WikipediaArticle | undefined {
    return poiId === null ? undefined : articles.find((article) => wikipediaPoiId(article.id) === poiId);
}
