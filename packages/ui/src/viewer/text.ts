/**
 * Viewer texts built from manifest data and the i18n catalogues: localized data fields (a language the city did not
 * write falls back to English, then Romanian: `localized` of @hcm/shared), photo dates, POI year spans, counted forms
 * and licences. Everything returned here is plain text that
 * the elements render with Lit templates, never as HTML.
 */
import { formatPhotoDate, isHttpsUrl, localized, translate, type License, type Photo, type Poi, type ViewerLocale } from '@hcm/shared';

/** A `{ro, en?}` data text (photo and POI texts: English is optional). */
export interface DataText {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** The text in `locale`, else in English, else in Romanian. */
export function localizedText(text: DataText, locale: ViewerLocale): string {
    return localized(text, locale);
}

type PhotoDate = Pick<Photo, 'year' | 'yearEnd' | 'month' | 'day' | 'dateText'>;

function photoYears(photo: PhotoDate, locale: ViewerLocale): string {
    if (photo.year === undefined) {
        return translate(locale, 'photo.unknownYear');
    }
    if (photo.month !== undefined) {
        return formatPhotoDate({ year: photo.year, month: photo.month, day: photo.day }, locale);
    }
    const year = String(photo.year);
    return photo.yearEnd === undefined || photo.yearEnd === photo.year
        ? translate(locale, 'photo.year', { year })
        : translate(locale, 'photo.years', { year, yearEnd: String(photo.yearEnd) });
}

/**
 * How the photo is dated: the source's own words (`Vara lui 1936`), else its date at its precision (`12 iulie 1936`,
 * `Iulie 1936`), else its year or years, else "unknown year".
 */
export function photoDateText(photo: PhotoDate, locale: ViewerLocale): string {
    return photo.dateText === undefined ? photoYears(photo, locale) : localizedText(photo.dateText, locale);
}

/** The text of a photo's source link: its name, else the host of its address. */
export function photoSourceText(source: NonNullable<Photo['source']>): string {
    return source.label ?? (isHttpsUrl(source.url) ? new URL(source.url).hostname : source.url);
}

type PoiSpan = Pick<Poi, 'yearStart' | 'yearEnd' | 'yearSeen'>;

function closedSpan(start: number, end: number, locale: ViewerLocale): string {
    return start === end
        ? translate(locale, 'poi.year', { year: String(start) })
        : translate(locale, 'poi.years', { yearStart: String(start), yearEnd: String(end) });
}

/**
 * The years of a POI (`Între 1900 și 1986`, `Din 1890`, `Până în 1984`, or `Văzută pe harta din 1939` when only
 * `yearSeen` is set), or null when it has none.
 */
export function poiYearsText(poi: PoiSpan, locale: ViewerLocale): string | null {
    const { yearStart, yearEnd, yearSeen } = poi;
    if (yearStart !== undefined && yearEnd !== undefined) {
        return closedSpan(yearStart, yearEnd, locale);
    }
    if (yearStart !== undefined) {
        return translate(locale, 'poi.yearStart', { yearStart: String(yearStart) });
    }
    return openEndOrSeen(yearEnd, yearSeen, locale);
}

function openEndOrSeen(yearEnd: number | undefined, yearSeen: number | undefined, locale: ViewerLocale): string | null {
    if (yearEnd !== undefined) {
        return translate(locale, 'poi.yearEnd', { yearEnd: String(yearEnd) });
    }
    return yearSeen === undefined ? null : translate(locale, 'poi.yearSeen', { year: String(yearSeen) });
}

/**
 * `1 fotografie`, `3 fotografii`, `20 de fotografii` / `1 photo`, `3 photos` / `5 zdjęć`: the plural form of `locale`, one
 * of the six every catalogue spells out (`photos.count.zero` … `.other`, the i18n gate's rule).
 */
export function photoCountText(count: number, locale: ViewerLocale): string {
    return translate(locale, `photos.count.${new Intl.PluralRules(locale).select(count)}`, { count: String(count) });
}

export function licenseText(license: License, locale: ViewerLocale): string {
    return translate(locale, `license.${license}`);
}
