/**
 * `create-historic-city [dir]` (`docs/research/M5-interfaces.md` §4.3): a new city in the starter kit's three files,
 * from the template the package carries (`template/`), with minimum input: the Romanian name (the id follows it), the
 * rectangle, the seed (a default) and the Mapbox public token (optional). Only a new or empty folder is written to;
 * `--dry-run` lists the files and writes nothing.
 */
import {
    fillKitPage,
    isUsableCityId,
    KIT_FILES,
    KIT_PLACEHOLDER_TOKEN,
    MAX_CITY_ID_LENGTH,
    NEW_CITY_SEEDS,
    readKitEngine,
    suggestCityId,
    validateManifest,
    type CityBounds,
} from '@hcm/shared';
import { themeFromSeed } from '@hcm/ui/dynamic-color';

import { EXIT, refusal, type Context } from './context.js';
import { cityManifestText, type CityAnswers } from './manifest.js';
import type { Files } from './ports.js';
import { answer, boundsText, parseBounds, parseName, parseSeed, parseToken } from './questions.js';

/** Where the package carries the kit (`dist/template/`, copied from `templates/starter-kit/` by the build). */
export const TEMPLATE_FOLDER = 'template';

interface Template {
    readonly page: string;
    readonly manifest: string;
    readonly readme: string;
    readonly name: string;
    readonly bounds: CityBounds;
}

function readTemplate(files: Files): Template {
    const read = (file: string): string => files.readBundled(`${TEMPLATE_FOLDER}/${file}`);
    const manifest = read(KIT_FILES.manifest);
    const parsed = validateManifest(JSON.parse(manifest));
    if (!parsed.ok) {
        throw new Error(`the bundled ${TEMPLATE_FOLDER}/${KIT_FILES.manifest} is invalid`);
    }
    const [[west, south], [east, north]] = parsed.value.city.bounds;
    return {
        page: read(KIT_FILES.page),
        manifest,
        readme: read(KIT_FILES.readme),
        name: parsed.value.city.name.ro,
        bounds: { west, south, east, north },
    };
}

/** The target folder, refused unless it is new or empty. */
function emptyTarget(context: Context, dir: string): Files {
    const files = context.ports.files(dir);
    if (files.entries().length > 0) {
        throw refusal(context, 'cli.target.notEmpty', { dir });
    }
    return files;
}

function checkedId(context: Context, id: string): string {
    if (!isUsableCityId(id) || id.length > MAX_CITY_ID_LENGTH) {
        throw refusal(context, 'cli.id.invalid', { id });
    }
    return id;
}

async function answers(context: Context, template: Template, nameRo: string, id: string): Promise<CityAnswers> {
    const { options, t } = context;
    const fallbackBounds = boundsText(template.bounds);
    const bounds = await answer(context, {
        given: options.bbox,
        fallback: fallbackBounds,
        prompt: t('cli.ask.bbox', { default: fallbackBounds, name: template.name }),
        parse: parseBounds,
    });
    const seed = await answer(context, {
        given: options.seed,
        fallback: NEW_CITY_SEEDS[0],
        prompt: t('cli.ask.seed', { default: NEW_CITY_SEEDS[0] }),
        parse: parseSeed,
    });
    const token = await answer(context, {
        given: undefined,
        fallback: KIT_PLACEHOLDER_TOKEN,
        prompt: t('cli.ask.token'),
        parse: parseToken,
    });
    const nameEn = await answer(context, { given: options.nameEn ?? nameRo, fallback: nameRo, prompt: '', parse: parseName });
    return { id, name: { ro: nameRo, en: nameEn }, bounds, seed, token };
}

/** The three files of the new city, in writing order. */
function kitFiles(context: Context, template: Template, city: CityAnswers): readonly (readonly [string, string])[] {
    const name = city.name[context.locale];
    const page = fillKitPage(template.page, {
        engine: readKitEngine(template.page),
        lang: context.locale,
        title: name,
        heading: name,
        description: context.t('kit.description', { name }),
        themeColor: city.seed,
    });
    return [
        [KIT_FILES.page, page],
        [KIT_FILES.manifest, cityManifestText(template.manifest, city, themeFromSeed(city.seed), context.t)],
        [KIT_FILES.readme, template.readme],
    ];
}

function nextSteps(context: Context, city: CityAnswers, dir: string): void {
    const { terminal } = context.ports;
    terminal.say(context.t('cli.scaffold.done', { name: city.name[context.locale], dir }));
    if (city.token === KIT_PLACEHOLDER_TOKEN) {
        terminal.say(context.t('cli.scaffold.nextToken'));
    }
    terminal.say(context.t('cli.scaffold.nextServe', { dir }));
    terminal.say(context.t('cli.scaffold.nextPages'));
}

/** Writes `files` into `target` (`dir` as the owner named it), each line saying so; a dry run only says what it would write. */
export function writeFiles(context: Context, target: Files, dir: string, files: readonly (readonly [string, string])[]): void {
    const { options, ports, t } = context;
    for (const [file, content] of files) {
        if (options.dryRun) {
            ports.terminal.say(t('cli.files.wouldWrite', { file: `${dir}/${file}`, bytes: Buffer.byteLength(content) }));
        } else {
            target.write(file, content);
            ports.terminal.say(t('cli.files.written', { file: `${dir}/${file}` }));
        }
    }
}

/** The folder the city goes to: the one named (checked before any question), else one named after its id. */
function targetFolder(context: Context, id: string, named: Files | null): { readonly dir: string; readonly files: Files } {
    const dir = context.options.dir ?? id;
    return { dir, files: named ?? emptyTarget(context, dir) };
}

/** Runs the scaffold; a refusal (a folder that is not empty, a refused option) writes nothing. */
export async function scaffold(context: Context): Promise<number> {
    const { options, ports, t } = context;
    ports.terminal.say(t('cli.scaffold.intro'));
    const named = options.dir === undefined ? null : emptyTarget(context, options.dir);
    const template = readTemplate(ports.files(ports.env.cwd));
    const nameRo = await answer(context, {
        given: options.nameRo,
        fallback: template.name,
        prompt: t('cli.ask.name', { default: template.name }),
        parse: parseName,
    });
    const id = checkedId(context, options.id ?? suggestCityId(nameRo));
    const { dir, files } = targetFolder(context, id, named);
    const city = await answers(context, template, nameRo, id);
    writeFiles(context, files, dir, kitFiles(context, template, city));
    if (options.dryRun) {
        ports.terminal.say(t('cli.dryRun.nothing'));
    } else {
        nextSteps(context, city, dir);
    }
    return EXIT.done;
}
