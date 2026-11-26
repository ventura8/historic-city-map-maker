// The old site's later changes to the photos we migrated (`docs/research/M5-interfaces.md` → *Directions from the old
// site*): compares every photo of the seed and of its additions, with their final ids, with the old site's current
// legacy data, and writes the photos the old site gave a direction or a new place since as corrections keyed by photo
// id. The seed folders stay as migrated; only `<additions>/corrections.json` is (re)written.
//
//     node scripts/seed/legacy-corrections.mjs --later <old site's geojson/photos.json>
//         [--seed seed/bucharest] [--additions seed/bucharest-2023]
//
// The bearing and the field of view come from the old site's cones exactly as the first migration measured them
// (`migrateLegacyPhotos`). Every photo is reported: corrected, had the old site's already, no cone there, or gone from
// it. Exit status: 0 written, 1 an input is unreadable, 2 usage. Run it with Node 24 in the quality image.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const { shared } = await import('./sources.mjs');

const log = shared.createLogger('legacy-corrections');

function readOptions(argv) {
    try {
        const { values } = parseArgs({
            args: argv,
            options: {
                later: { type: 'string' },
                seed: { type: 'string', default: 'seed/bucharest' },
                additions: { type: 'string', default: 'seed/bucharest-2023' },
            },
            strict: true,
        });
        if (values.later === undefined) {
            throw new Error('--later is required');
        }
        return values;
    } catch (error) {
        log.error('usage: legacy-corrections.mjs --later <geojson> [--seed <dir>] [--additions <dir>]', { reason: String(error) });
        process.exitCode = 2;
        return null;
    }
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/** The seed's photos, then the additions', each folder's ids clear of the ones before it (as the admin's bundle has them). */
function ourPhotos(dirs) {
    const photos = [];
    for (const dir of dirs) {
        const reserved = photos.map((record) => record.photo.id);
        photos.push(...shared.migrateLegacyPhotos(readJson(join(dir, 'photos.legacy.geojson')), shared.KNOWN_HTTPS_HOSTS, reserved).photos);
    }
    return photos;
}

function main(options) {
    let ours;
    let later;
    try {
        ours = ourPhotos([options.seed, options.additions]);
        later = readJson(options.later);
    } catch (error) {
        log.error('an input is unreadable', { reason: String(error) });
        return 1;
    }
    const { corrections, report } = shared.deriveLegacyCorrections(ours, later);
    for (const row of report) {
        log.info('photo', row);
    }
    const counts = Object.groupBy(report, (row) => row.status);
    const summary = Object.fromEntries(Object.entries(counts).map(([status, rows]) => [status, rows.length]));
    writeFileSync(join(options.additions, 'corrections.json'), `${JSON.stringify(corrections, null, 4)}\n`, 'utf8');
    log.info('corrections written', { photos: report.length, ...summary });
    return 0;
}

const options = readOptions(process.argv.slice(2));
if (options !== null) {
    process.exitCode = main(options);
}
