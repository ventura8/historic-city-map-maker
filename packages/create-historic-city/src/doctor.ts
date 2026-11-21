/**
 * `create-historic-city doctor [dir]` (`docs/research/M5-interfaces.md` §4.2): what a city folder and this machine need,
 * each check on its own line. Node's release, `city.json` (valid, and no longer the placeholder token) and the page's
 * engine pins count as problems (exit status 1); `firebase` and `gcloud` are reported, needed only to self-host.
 */
import {
    compareVersions,
    isUnpinned,
    KIT_FILES,
    KIT_PLACEHOLDER_TOKEN,
    kitResult,
    parseManifestJson,
    readKitEngine,
    type KitEngine,
} from '@hcm/shared';

import { EXIT, type Context } from './context.js';
import type { CliKey } from './i18n/index.js';
import type { Files } from './ports.js';
import { FIREBASE, FIREBASE_TOOLS_VERSION, GCLOUD } from './self-host/tools.js';
import { TEMPLATE_FOLDER } from './scaffold.js';
import { sameEngine } from './upgrade.js';
import { NPX_COMMAND } from './version.js';

/** The oldest Node the CLI runs on (`engines` of its package). */
const MIN_NODE = '24.12.0';

type Level = 'ok' | 'problem' | 'optional';

interface Finding {
    readonly level: Level;
    readonly key: CliKey;
    readonly params?: Readonly<Record<string, string>>;
}

const LINE_KEYS: Readonly<Record<Level, CliKey>> = { ok: 'cli.doctor.ok', problem: 'cli.doctor.problem', optional: 'cli.doctor.optional' };

function node(context: Context): Finding {
    const version = context.ports.env.nodeVersion;
    return (compareVersions(version, MIN_NODE) ?? -1) >= 0
        ? { level: 'ok', key: 'cli.doctor.node', params: { version } }
        : { level: 'problem', key: 'cli.doctor.nodeOld', params: { version, min: MIN_NODE } };
}

async function tool(context: Context, command: string, found: CliKey, missing: CliKey): Promise<Finding> {
    const result = await context.ports.runner.capture(command, ['--version']);
    return result === null ? { level: 'optional', key: missing, params: { version: FIREBASE_TOOLS_VERSION } } : { level: 'ok', key: found };
}

function manifest(files: Files): readonly Finding[] {
    if (!files.exists(KIT_FILES.manifest)) {
        return [{ level: 'problem', key: 'cli.doctor.manifestMissing' }];
    }
    const parsed = parseManifestJson(files.read(KIT_FILES.manifest));
    if (!parsed.ok) {
        const detail = parsed.issues.map((issue) => `${issue.path} ${issue.code}`).join(', ');
        return [{ level: 'problem', key: 'cli.doctor.manifestInvalid', params: { detail } }];
    }
    const token: readonly Finding[] =
        parsed.value.city.mapbox.publicToken === KIT_PLACEHOLDER_TOKEN ? [{ level: 'problem', key: 'cli.doctor.token' }] : [];
    return [{ level: 'ok', key: 'cli.doctor.manifest' }, ...token];
}

/** The page's engine, or why it cannot be read. */
function pageEngine(page: string): KitEngine | Finding {
    const engine = kitResult(() => readKitEngine(page));
    return engine.ok ? engine.value : { level: 'problem', key: 'cli.page.invalid', params: { detail: engine.error.message } };
}

/** The page's pins against the release this CLI carries. */
function compared(page: KitEngine, files: Files): Finding {
    if (isUnpinned(page)) {
        return { level: 'problem', key: 'cli.doctor.pinsUnpinned' };
    }
    const released = readKitEngine(files.readBundled(`${TEMPLATE_FOLDER}/${KIT_FILES.page}`));
    return sameEngine(page, released)
        ? { level: 'ok', key: 'cli.doctor.pins' }
        : { level: 'problem', key: 'cli.doctor.pinsOther', params: { command: NPX_COMMAND } };
}

function pins(context: Context, files: Files): Finding {
    if (!files.exists(KIT_FILES.page)) {
        return { level: 'problem', key: 'cli.page.missing', params: { dir: context.options.dir ?? '.' } };
    }
    const page = pageEngine(files.read(KIT_FILES.page));
    return 'level' in page ? page : compared(page, files);
}

/** Whether the owner's tools are installed (not in a dry run, which runs nothing). */
async function toolFindings(context: Context): Promise<readonly Finding[]> {
    if (context.options.dryRun) {
        return [];
    }
    return [
        await tool(context, FIREBASE, 'cli.doctor.firebase', 'cli.doctor.firebaseMissing'),
        await tool(context, GCLOUD, 'cli.doctor.gcloud', 'cli.doctor.gcloudMissing'),
    ];
}

function report(context: Context, findings: readonly Finding[]): number {
    const { ports, t } = context;
    for (const finding of findings) {
        ports.terminal.say(t(LINE_KEYS[finding.level], { check: t(finding.key, finding.params) }));
    }
    const problems = findings.filter((finding) => finding.level === 'problem').length;
    ports.terminal.say(problems === 0 ? t('cli.doctor.clean') : t('cli.doctor.summary', { count: problems }));
    return problems === 0 ? EXIT.done : EXIT.failed;
}

export async function doctor(context: Context): Promise<number> {
    const files = context.ports.files(context.options.dir ?? '.');
    return report(context, [node(context), ...(await toolFindings(context)), ...manifest(files), pins(context, files)]);
}
