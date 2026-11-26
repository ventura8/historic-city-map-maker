/**
 * The two documents a static export writes for its owner (M5, `docs/research/M5-interfaces.md` §5.1, §5.2), in English
 * only like all of the project's Markdown (the owner's rule of 2026-11-10; the exported page itself keeps its languages):
 * `README.md` (what is inside, how to serve it, the viewer token, the scans, then the kit's own README) and `RIGHTS.md`
 * (every photo licensed for this map only). Names and titles are
 * the owner's plain text: whitespace is collapsed and Markdown's and HTML's special characters escaped, so a title can
 * never become a heading, a table column or markup in a renderer that shows the file.
 */
import type { Manifest, Photo } from '@hcm/shared';

const MARKDOWN_SPECIAL = /[\\`*_[\]<>|#]/g;

/** One line of the owner's text, safe inside a Markdown heading, list item or table cell. */
export function markdownLine(value: string): string {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(MARKDOWN_SPECIAL, (character) => `\\${character}`);
}

interface ReadmeInput {
    readonly manifest: Manifest;
    /** How many USGS scans are in `rasters/` (0: none were asked for, or none may travel). */
    readonly rasters: number;
    readonly kitReadme: string;
    readonly madeAt: Date;
}

function day(at: Date): string {
    return at.toISOString().slice(0, 10);
}

function preface(input: ReadmeInput, name: string): string {
    const scans =
        input.rasters > 0
            ? `- \`rasters/\`: the USGS scans of the historical layers (${String(input.rasters)}), in the public domain, as Cloud-Optimized GeoTIFFs.`
            : '- the USGS scans are not included (the export includes them only when asked).';
    return [
        `This archive holds everything the map ${name} needs to run on any static host, without Firebase:`,
        '',
        '- `index.html`: the map’s page;',
        '- `city.json`: the city’s data (places, photos, stories, historical layers);',
        '- `engine/`: the map engine, served from the same site;',
        '- `photos/`: the published photos;',
        '- `RIGHTS.md`: the photos published with permission for this map only;',
        scans,
        '',
        '1. Serve the folder from a web server (GitHub Pages, any static host or `npx serve`). Opened straight from the file',
        '   (`file://`), the page cannot read `city.json` and shows an error.',
        '2. The Mapbox token in `city.json` (`city.mapbox.publicToken`) is restricted to the original site’s address. For',
        '   another address, create a public token (`pk.`) of your own in your Mapbox account and replace it.',
        '3. The historical layers stay references to their tiles; a layer uploaded as a GeoTIFF does not export its scan, because',
        '   its rights are not known.',
        '4. The photos in `RIGHTS.md` may not be republished elsewhere without their rights holders’ consent.',
    ].join('\n');
}

/** `README.md`: the export's preface, then the starter kit's README as it is. */
export function exportReadme(input: ReadmeInput): string {
    const name = markdownLine(input.manifest.city.name.en);
    return [`# ${name}: static export (${day(input.madeAt)})`, '', preface(input, name), '', '---', '', input.kitReadme.trimEnd(), ''].join(
        '\n',
    );
}

function rightsRow(photo: Photo): string {
    const title = markdownLine(photo.title.en ?? photo.title.ro);
    const holder = markdownLine(photo.rightsHolder ?? photo.author ?? '—');
    return `| \`${photo.id}\` | ${title} | ${holder} | ${photo.license} |`;
}

/** `RIGHTS.md`: the photos licensed for this map only, with their rights holders (none: it says so). */
export function rightsDocument(city: Manifest['city']['name'], photos: readonly Photo[]): string {
    const head = [
        '# Rights',
        '',
        `The photos below are published with their rights holders’ permission for the map ${markdownLine(city.en)} only.`,
        'Do not republish them elsewhere without their consent.',
        '',
    ];
    if (photos.length === 0) {
        return [...head, 'No photo has this restriction.', ''].join('\n');
    }
    return [...head, '| Photo | Title | Rights holder | Licence |', '| --- | --- | --- | --- |', ...photos.map(rightsRow), ''].join('\n');
}
