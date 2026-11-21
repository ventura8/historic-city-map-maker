/**
 * `create-historic-city upgrade [dir]` (`docs/research/M5-interfaces.md` §4.2): rewrites only the engine block and the
 * CSP of the city's `index.html` with the pins of this CLI's release (the template it carries). The policy keeps every
 * origin the page added (the tile and photo hosts its owner or its export put in `img-src` and `connect-src`) and its
 * telemetry's hosts or their absence (`policyExtras`; `docs/LESSONS.md` 242). A CLI built before any release carries
 * the template's placeholder and refuses.
 */
import {
    fillKitPage,
    isUnpinned,
    KIT_FILES,
    kitResult,
    policyExtras,
    readKitEngine,
    readKitPolicy,
    type KitEngine,
    type KitPageValues,
    type KitRelease,
} from '@hcm/shared';

import { EXIT, refusal, type Context } from './context.js';
import type { Files } from './ports.js';
import { TEMPLATE_FOLDER } from './scaffold.js';
import { NPX_COMMAND } from './version.js';

/** A page the kit's functions cannot read or fill is the owner's to fix: a refusal naming why. */
function pageWork<T>(context: Context, work: () => T): T {
    const result = kitResult(work);
    if (!result.ok) {
        throw refusal(context, 'cli.page.invalid', { detail: result.error.message });
    }
    return result.value;
}

/** The release the carried template pins; a template that pins none (a build before any release) refuses. */
function releasedEngine(context: Context, files: Files): { readonly kind: 'cdn'; readonly release: KitRelease } {
    const engine = readKitEngine(files.readBundled(`${TEMPLATE_FOLDER}/${KIT_FILES.page}`));
    if (engine.kind !== 'cdn' || isUnpinned(engine)) {
        throw refusal(context, 'cli.upgrade.unpinned', { command: NPX_COMMAND });
    }
    return engine;
}

/** The engine a city's page loads. */
export function pageEngine(context: Context, page: string): KitEngine {
    return pageWork(context, () => readKitEngine(page));
}

export function sameEngine(a: KitEngine, b: KitEngine): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** `page` filled anew with `values`, its policy keeping what the page added to the fixed one (a refusal when unreadable). */
export function refilledPage(context: Context, page: string, values: KitPageValues): string {
    return pageWork(context, () => fillKitPage(page, { ...policyExtras(readKitPolicy(page)), ...values }));
}

export function upgrade(context: Context): Promise<number> {
    const { options, ports, t } = context;
    const dir = options.dir ?? '.';
    const files = ports.files(dir);
    if (!files.exists(KIT_FILES.page)) {
        throw refusal(context, 'cli.page.missing', { dir });
    }
    const engine = releasedEngine(context, files);
    const page = files.read(KIT_FILES.page);
    if (sameEngine(pageEngine(context, page), engine)) {
        ports.terminal.say(t('cli.upgrade.same'));
        return Promise.resolve(EXIT.done);
    }
    const next = refilledPage(context, page, { engine });
    if (options.dryRun) {
        ports.terminal.say(t('cli.files.wouldWrite', { file: `${dir}/${KIT_FILES.page}`, bytes: Buffer.byteLength(next) }));
        ports.terminal.say(t('cli.dryRun.nothing'));
    } else {
        files.write(KIT_FILES.page, next);
        ports.terminal.say(t('cli.upgrade.done', { base: engine.release.base }));
    }
    return Promise.resolve(EXIT.done);
}
