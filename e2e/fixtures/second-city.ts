import { validateManifest, type Manifest } from '@hcm/shared';

import { buildFixtureManifest } from './manifest.js';

/**
 * The e2e world's second public city (M5, `docs/research/M5-interfaces.md` §1.10, §8; behaviour V26): the GitHub Pages
 * tree of the e2e build holds Bucharest at its root, `e2e-second` (its own fixture manifest, bundled) and
 * `e2e-unpublished` (a city whose page reads the public bucket only and whose manifest is not published yet). Their sites
 * are `e2e/fixtures/sites/<city>/`, never `sites/`: a production build would publish them.
 */

/** The second city: its id, its site folder and its Pages path. */
export const SECOND_CITY = 'e2e-second';
/** A city added with `site:add` before the admin published it: the bucket answers 404. */
export const UNPUBLISHED_CITY = 'e2e-unpublished';
/** Where the e2e build assembles the Pages tree, below the site server's root (`dist/e2e-site/pages`). */
export const PAGES_FOLDER = 'pages';
/** The second city's photos: the first few of the Bucharest seed, enough to tell the two manifests apart. */
export const SECOND_CITY_PHOTOS = 3;

/** The second city's manifest: Bucharest's fixture renamed, without layers and places, with three photos. */
export function buildSecondCityManifest(): Manifest {
    const bucharest = buildFixtureManifest({ layers: false, pois: false });
    const data = {
        ...bucharest,
        city: { ...bucharest.city, id: SECOND_CITY, name: { ro: 'Al doilea oraș (e2e)', en: 'Second city (e2e)' } },
        photos: bucharest.photos.slice(0, SECOND_CITY_PHOTOS),
    };
    const result = validateManifest(data);
    if (!result.ok) {
        const issues = result.issues.map((issue) => [issue.path, issue.code].join(' ')).join('; ');
        throw new Error(`the second city's manifest is invalid: ${issues}`);
    }
    return result.value;
}
