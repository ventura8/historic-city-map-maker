/**
 * `create-historic-city theme [dir] --seed <#rrggbb>`: the map's colours from one colour, as the scaffold and the admin's
 * Settings make them (`themeFromSeed`). The viewer reads `city.theme.tokens` of `city.json` (the four schemes the seed
 * gives), never the seed alone, so changing `seedColor` by hand changes nothing: this command rewrites both, and the
 * page's `theme-color`, keeping the rest of each file (the page's policy too: `refilledPage`). Without `--seed` it asks,
 * offering the current colour; `--dry-run` writes nothing.
 */
import { KIT_FILES, parseManifestJson } from '@hcm/shared';
import { themeFromSeed } from '@hcm/ui/dynamic-color';

import { EXIT, refusal, type Context } from './context.js';
import type { Files } from './ports.js';
import { answer, parseSeed } from './questions.js';
import { writeFiles } from './scaffold.js';
import { pageEngine, refilledPage } from './upgrade.js';
import { NPX_COMMAND } from './version.js';

/** The folder's `city.json` as written (an object, valid as a City Manifest v1) and its seed; refused otherwise. */
function cityFile(context: Context, files: Files, dir: string): { readonly json: Record<string, unknown>; readonly seed: string } {
    if (!files.exists(KIT_FILES.manifest)) {
        throw refusal(context, 'cli.admin.noKit', { dir, command: NPX_COMMAND });
    }
    const text = files.read(KIT_FILES.manifest);
    const parsed = parseManifestJson(text);
    if (!parsed.ok) {
        throw refusal(context, 'cli.doctor.manifestInvalid', {
            detail: parsed.issues.map((issue) => `${issue.path} ${issue.code}`).join(', '),
        });
    }
    return { json: JSON.parse(text) as Record<string, unknown>, seed: parsed.value.city.theme.seedColor };
}

/** `json` (a valid manifest) with its city's theme made from `seed`: still valid, every other field as it was. */
function themed(json: Record<string, unknown>, seed: string): string {
    const city = json['city'] as Record<string, unknown>;
    return `${JSON.stringify({ ...json, city: { ...city, theme: { seedColor: seed, tokens: themeFromSeed(seed) } } }, null, 4)}\n`;
}

export async function theme(context: Context): Promise<number> {
    const { options, ports, t } = context;
    const dir = options.dir ?? '.';
    const files = ports.files(dir);
    const current = cityFile(context, files, dir);
    if (!files.exists(KIT_FILES.page)) {
        throw refusal(context, 'cli.page.missing', { dir });
    }
    const page = files.read(KIT_FILES.page);
    const engine = pageEngine(context, page);
    const seed = await answer(context, {
        given: options.seed,
        fallback: current.seed,
        prompt: t('cli.ask.seed', { default: current.seed }),
        parse: parseSeed,
    });
    writeFiles(context, files, dir, [
        [KIT_FILES.manifest, themed(current.json, seed)],
        [KIT_FILES.page, refilledPage(context, page, { engine, themeColor: seed })],
    ]);
    ports.terminal.say(options.dryRun ? t('cli.dryRun.nothing') : t('cli.theme.done', { seed }));
    return EXIT.done;
}
