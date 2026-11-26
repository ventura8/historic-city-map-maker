import type { CensusKey } from './ro.js';

/** English texts of the imagery census (M29), typed against the Romanian source of truth (`ro.ts`). */
export const en: Readonly<Record<CensusKey, string>> = {
    'census.title': 'Old satellite images of the chosen city',
    'census.waiting': 'Fill in the four edges of the city to see how many old images exist.',
    'census.loading': 'Looking for the city’s old images in the public Landsat catalogue…',
    'census.total': 'Images found in all: between {low} and {high}',
    'census.free': 'Free: between {low} and {high}',
    'census.paid': 'Paid: between {low} and {high} (scanned on request)',
    'census.landsat': 'Landsat (1972 to today, free): {count} images with few clouds, counted exactly just now.',
    'census.landsatMore': 'Landsat (1972 to today, free): more than {count} images with few clouds; the count stopped here.',
    'census.declassified': 'Declassified spy photos (1960 to 1984): an estimate, not an exact count.',
    'census.declassifiedFree': 'already scanned, free: between {low} and {high}',
    'census.declassifiedPaid': 'to be scanned on request: between {low} and {high}, {scan} a frame plus {fee} an order',
    'census.unlock': 'The exact number of declassified photos appears after the USGS step of Setup (a free account).',
    'census.unlockLink': 'Open the USGS step',
    'census.previews': 'The clearest Landsat image of each decade',
    'census.preview': 'The {decade}s: Landsat {mission}, {date}, clouds {cloud}%',
    'census.noPreview': 'The catalogue has no preview for this image.',
    'census.none': 'The catalogue has no Landsat image with few clouds for this rectangle.',
    'census.source': 'Counted in Microsoft Planetary Computer’s public Landsat catalogue; the declassified estimate from {date}.',
    'census.failed.offline': 'Could not reach the Landsat catalogue: the browser seems offline or blocks its address.',
    'census.failed.refused': 'The Landsat catalogue refused the search just now, probably because it is busy.',
    'census.failed.unreadable': 'The Landsat catalogue answered in a form the app no longer recognises.',
    'census.failed.help': 'You can go on without the count: the images are searched anyway after setup. Try again in a minute.',
    'census.retry': 'Search again',
};
