import { z } from 'zod';

import { ID_PATTERN, validate } from '@hcm/shared';

import { SiteBuildError, issuesText } from './errors.js';

/**
 * `site.json`: what one static site needs besides its `config.js` and `site.css`. The page itself is generated
 * (`page.ts`); nothing in this file is HTML.
 *
 * ```json
 * { "lang": "ro", "title": "București dispărut", "description": "…", "themeColor": "#8B5E3C",
 *   "noscript": { "ro": "…", "en": "…" },
 *   "manifest": "seed/bucharest/manifest.static.json", "legacyCityId": "bucuresti", "media": "seed/bucharest/derived",
 *   "additions": ["seed/bucharest-2023"], "publicManifest": true, "pagesPath": "" }
 * ```
 *
 * M5 (`docs/research/M5-interfaces.md` §1.10): a city added after Bucharest (`npm run site:add`) has no seed manifest:
 * it reads the manifest the admin publishes (`publicManifest: true`), so it is built only when the build names the
 * public bucket.
 */

/** A path inside the repository: relative, no `..` segment, no backslash. */
const REPOSITORY_PATH = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[\w.\-/]+$/;

/** Where the GitHub Pages site serves a city's site: `""` (the root: Bucharest's old links) or one folder, `<city>/`. */
const PAGES_PATH = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?$/;

const text = (max: number) => z.string().trim().min(1).max(max);
const repositoryPath = z.string().max(300).regex(REPOSITORY_PATH);

const siteSpecSchema = z
    .strictObject({
        /** The page's `<html lang>` until the engine resolves the visitor's language (docs/ENGINE_API.md → Language). */
        lang: z.enum(['ro', 'en']),
        title: text(100),
        description: text(300),
        /** The browser UI colour (`<meta name="theme-color">`), usually the city's seed colour. */
        themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        /** Shown when JavaScript is off: one paragraph per language. */
        noscript: z.strictObject({ ro: text(300), en: text(300) }),
        /**
         * The source manifest (City Manifest v1); written to `data/manifest.json` with its photos rewritten. None for a city
         * that only reads the public bucket (M5).
         */
        manifest: repositoryPath.optional(),
        /**
         * The city id the source manifest names when it is not `config.js`'s: the legacy Bucharest manifest, migrated as it
         * was (`seed/bucharest/`), names `bucuresti`, while the project's city, and so every manifest the backend builds, is
         * `bucharest` (`DECISIONS-for-review.md` §35b). The build serves such a manifest under `config.js`'s `cityId`; any
         * other mismatch still fails the build.
         */
        legacyCityId: z.string().regex(ID_PATTERN).optional(),
        /** Where the photo derivatives live, as `<photo id>/<file>` (the migration's `derived/` folder); with a seed manifest. */
        media: repositoryPath.optional(),
        /**
         * Seed folders whose photos join the seed manifest's (`additions.ts`): the old site's 2023 additions, migrated on
         * their own because `seed/bucharest/` stays as migrated. Each holds `manifest.static.json`, `derived/` and, when the
         * old site changed photos already migrated, `corrections.json`.
         */
        additions: z.array(repositoryPath).max(10).optional(),
        /**
         * The page reads the manifest the admin publishes to the project's public bucket when the build names it
         * (`HCM_PUBLIC_BUCKET`), and bundles `manifest` only without one (`public-manifest.ts`, DECISIONS-for-review.md §51e).
         */
        publicManifest: z.boolean().optional(),
        /** M5: where the Pages site serves this one (`npm run build:site -- --pages`); default `<the site's folder>/`. */
        pagesPath: z.string().max(64).regex(PAGES_PATH).optional(),
    })
    // A site without a seed manifest has nothing to bundle: it reads the public bucket's.
    .refine((spec) => spec.manifest !== undefined || spec.publicManifest === true, {
        message: 'validation.manifestSource',
        path: ['manifest'],
    })
    // A seed manifest's photos are copied from `media`.
    .refine((spec) => spec.manifest === undefined || spec.media !== undefined, { message: 'validation.required', path: ['media'] })
    // Additions join a seed manifest.
    .refine((spec) => spec.additions === undefined || spec.manifest !== undefined, { message: 'validation.required', path: ['manifest'] });

export type SiteSpec = z.infer<typeof siteSpecSchema>;

/** The validated `site.json` text; throws SiteBuildError on bad JSON or an invalid field. */
export function parseSiteSpec(json: string, filename = 'site.json'): SiteSpec {
    let input: unknown;
    try {
        input = JSON.parse(json);
    } catch (error: unknown) {
        throw new SiteBuildError(`${filename}: not JSON: ${String(error)}`);
    }
    const result = validate(siteSpecSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${filename}: invalid\n${issuesText(result.issues)}`);
    }
    return result.value;
}

/** Where the Pages tree serves the site of the folder `folder`: its `pagesPath`, else `<folder>/`. */
export function pagesPathOf(spec: SiteSpec, folder: string): string {
    return spec.pagesPath ?? `${folder}/`;
}
