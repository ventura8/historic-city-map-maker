import { readFileSync } from 'node:fs';

import { build, parseSync, type ESTree, type InlineConfig, type PluginOption, type Rolldown } from 'vite';

import { subresourceIntegrity } from './sri.js';

/**
 * The engine's extras, loaded on demand (docs/ENGINE_API.md → *Extras on demand*, DECISIONS-for-review.md §186): code no
 * first paint needs is not part of `engine.iife.js` or `engine.mjs` but a classic script beside them,
 * `extra-<name>-<hash>.js`, that the engine adds with its Subresource Integrity the first time it is wanted
 * (`packages/engine/src/extras/loader.ts`). An IIFE has no code splitting, so before this the IIFE carried every lazy
 * chunk inline; now both builds load the same files, and a page that pins the engine with `integrity` covers them.
 *
 * - Each extra is built on its own (Vite, IIFE, minified, a hidden source map: the release keeps no source-map line and
 *   every byte the integrity covers) when the engine's build starts, and its exports are registered on the page's host
 *   (`<registry>.<global>`, `extend`). Its last statement marks it ready (`<ready>.<global> = true`, `readyFooter`): the
 *   registry's entry exists from the script's first statement, so only the mark tells the loader the script did not throw. What it shares with the engine, Lit and `@hcm/shared` (one copy and one catalogue
 *   state per page), it takes from the host's globals (`host`), never from its own copy: an extra carrying a module of
 *   `forbidden` stops the build, and so does a binding it imports from the host that the host's module does not export.
 * - The engine's `imports.ts` (`importsModule`: a dynamic import per extra, as the tests run it) is replaced by
 *   generated code that calls the runtime's `loadExtra` with each extra's file and integrity, so the builds' module graph
 *   holds none of the extras' code.
 * - Each output gets the extras' files and maps as assets, and `modules()` lists their modules for the notices.
 *
 * Its own error class, as `notices.ts`: the Vite config loads this module through Node.
 */
class EngineExtrasError extends Error {
    override readonly name = 'EngineExtrasError';
}

/** One extra: its name in file names and budgets, its key on the host's registry and in `imports.ts`, its entry module. */
export interface EngineExtra {
    readonly name: string;
    readonly global: string;
    readonly entry: string;
}

/** A package the extras take from the engine: the specifier, the host's global for it, and the module listing its bindings. */
interface HostModule {
    readonly specifier: string;
    readonly global: string;
    readonly module: string;
}

export interface EngineExtrasOptions {
    /** The engine package's folder (the extras' builds resolve from it). */
    readonly root: string;
    /** `packages/engine/src/extras/imports.ts`, replaced in the builds. */
    readonly importsModule: string;
    /** `packages/engine/src/extras/runtime.ts`, whose `loadExtra` the generated module calls. */
    readonly runtimeModule: string;
    /** The release's entry on the host (`hostKeyOf(ENGINE_VERSION)`), which the generated module gives the loader. */
    readonly hostKey: string;
    /** The host's registry the extras register on (`__hcmEngineHost.<release>.extras`). */
    readonly registry: string;
    /** The host's record each extra marks itself ready on, its last statement (`__hcmEngineHost.<release>.ready`). */
    readonly ready: string;
    readonly extras: readonly EngineExtra[];
    readonly host: readonly HostModule[];
    /** Modules an extra must take from the host and never carry (Lit, the catalogues, zod). */
    readonly forbidden: RegExp;
    /** The plugins each extra's build runs (the engine's CSS minifier, zod's stand-ins). */
    readonly plugins: () => PluginOption[];
}

/** An extra as built: its file, integrity, code, map and the modules it carries. */
export interface BuiltExtra {
    readonly extra: EngineExtra;
    readonly fileName: string;
    readonly integrity: string;
    readonly code: string;
    readonly map: string;
    readonly modules: readonly string[];
}

/** `extra-<name>-<hash>.js`: the hash is the integrity's first eight characters, URL-safe. */
export function extraFileName(name: string, integrity: string): string {
    const digest = integrity
        .slice('sha384-'.length, 'sha384-'.length + 8)
        .replaceAll('+', '-')
        .replaceAll('/', '_');
    return `extra-${name}-${digest}.js`;
}

/** The released bytes: a final newline (the release adds one to every text file, which the integrity must include). */
export function finishedCode(code: string): string {
    return code.endsWith('\n') ? code : `${code}\n`;
}

/**
 * A release's entry on the extras' host (`packages/engine/src/extras/host.ts`): an identifier the extras' scripts can
 * name, `1.2.0-beta.1` -> `v1_2_0_beta_1`. Two engine releases on one page keep apart this way.
 */
export function hostKeyOf(version: string): string {
    return `v${version.replaceAll(/\W/g, '_')}`;
}

/** The extra's last statement: marks it ready on the host once everything before it ran (the IIFE threw nothing). */
export function readyFooter(ready: string, global: string): string {
    return `(function(r){r[${JSON.stringify(global)}]=!0})(this.${ready}=this.${ready}||{});`;
}

/** The generated `imports.ts`: one loader call per extra with its file and integrity. */
export function importsModuleCode(runtimeModule: string, hostKey: string, built: readonly BuiltExtra[]): string {
    const entries = built.map((item) => {
        const file = { host: hostKey, global: item.extra.global, file: item.fileName, integrity: item.integrity };
        return `    ${JSON.stringify(item.extra.global)}: () => loadExtra(${JSON.stringify(file)}),`;
    });
    return [`import { loadExtra } from ${JSON.stringify(runtimeModule)};`, 'export const extraImports = {', ...entries, '};', ''].join(
        '\n',
    );
}

interface Named {
    readonly type: string;
    readonly name?: string;
    readonly value?: unknown;
}

function nameOf(node: Named): string {
    return node.type === 'Identifier' ? String(node.name) : String(node.value);
}

/** What a default and a namespace import take from their module (`import a from` -> default, `import * as a from` -> *). */
const SPECIAL_IMPORTS: Readonly<Record<string, string>> = { ImportDefaultSpecifier: 'default', ImportNamespaceSpecifier: '*' };

/** Specifier -> the names an ES module imports from it (`import { a as b } from 'x'` -> x: a). */
export function importedBindings(code: string): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const node of parseSync('extra.js', code).program.body) {
        if (node.type === 'ImportDeclaration') {
            const names = node.specifiers.map(
                (specifier) => SPECIAL_IMPORTS[specifier.type] ?? nameOf(Reflect.get(specifier, 'imported') as Named),
            );
            found.set(node.source.value, [...(found.get(node.source.value) ?? []), ...names]);
        }
    }
    return found;
}

/** The names a host module re-exports (`export { a, b } from 'x'`). */
export function exportedNames(file: string, source: string): Set<string> {
    const names = new Set<string>();
    for (const node of parseSync(file, source).program.body) {
        if (node.type === 'ExportNamedDeclaration') {
            node.specifiers.forEach((specifier) => names.add(nameOf(specifier.exported)));
        }
    }
    return names;
}

interface PropertyLike {
    readonly type: string;
    readonly key?: unknown;
}

/** A plain key's name; a spread (or anything else) is `...`, which never matches an extra. */
function keyOf(property: PropertyLike): string {
    return property.type === 'Property' ? nameOf(property.key as Named) : '...';
}

/** The declaration of `export const name = …`, or null for any other statement. */
function exportedDeclaration(node: ESTree.Statement): ESTree.VariableDeclaration | null {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : null;
    return declaration?.type === 'VariableDeclaration' ? declaration : null;
}

/** The value of `export const name = …`, or undefined for any other statement. */
function exportedValue(node: ESTree.Statement): ESTree.Expression | null | undefined {
    return exportedDeclaration(node)?.declarations[0]?.init;
}

/** The properties of `export const name = { … }`, or none for any other statement. */
function exportedObject(node: ESTree.Statement): readonly PropertyLike[] {
    const value = exportedValue(node);
    return value?.type === 'ObjectExpression' ? value.properties : [];
}

/** The keys of the object `imports.ts` exports (`export const extraImports = { compare: …, gamepad: … }`), in order. */
export function importedKeys(file: string, source: string): string[] {
    return parseSync(file, source).program.body.flatMap((node) => exportedObject(node).map(keyOf));
}

/** What is wrong with an extra: a module it must take from the host, or a host binding the host does not export. */
export function extraProblems(
    extra: EngineExtra,
    found: { readonly modules: readonly string[]; readonly bindings: ReadonlyMap<string, readonly string[]> },
    hostExports: ReadonlyMap<string, ReadonlySet<string>>,
    forbidden: RegExp,
): string[] {
    const carried = found.modules
        .filter((id) => forbidden.test(id))
        .map((id) => `${extra.name} carries ${id}: it must take it from the host`);
    const missing = [...found.bindings].flatMap(([specifier, names]) => {
        const exported = hostExports.get(specifier);
        if (exported === undefined) {
            return [`${extra.name} imports ${specifier}, which is no host module: bundle it or add it to the host`];
        }
        return names
            .filter((name) => !exported.has(name))
            .map((name) => `${extra.name} imports ${name} from ${specifier}: the host does not export it`);
    });
    return [...carried, ...missing];
}

function extraConfig(options: EngineExtrasOptions, extra: EngineExtra): InlineConfig {
    const globals: Record<string, string> = { 'mapbox-gl': 'mapboxgl' };
    for (const host of options.host) {
        globals[host.specifier] = host.global;
    }
    return {
        configFile: false,
        root: options.root,
        logLevel: 'warn',
        plugins: options.plugins(),
        build: {
            write: false,
            minify: true,
            sourcemap: 'hidden',
            copyPublicDir: false,
            lib: { entry: extra.entry, name: `${options.registry}.${extra.global}`, fileName: 'extra' },
            rolldownOptions: {
                external: Object.keys(globals),
                output: [
                    {
                        format: 'iife',
                        name: `${options.registry}.${extra.global}`,
                        extend: true,
                        globals,
                        entryFileNames: 'extra.js',
                        footer: readyFooter(options.ready, extra.global),
                    },
                    { format: 'es', entryFileNames: 'extra.mjs' },
                ],
            },
        },
    };
}

/** Builds one extra and checks it against the host. */
async function buildExtra(
    options: EngineExtrasOptions,
    extra: EngineExtra,
    hostExports: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<BuiltExtra> {
    const outputs = (await build(extraConfig(options, extra))) as Rolldown.RolldownOutput[];
    // Rolldown lists an output's entry chunk first; each extra has one chunk per output (IIFE, then ES).
    const [iife, es] = outputs.map((output) => output.output[0]) as [Rolldown.OutputChunk, Rolldown.OutputChunk];
    const modules = Object.entries(iife.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id]) => id);
    const problems = extraProblems(extra, { modules, bindings: importedBindings(es.code) }, hostExports, options.forbidden);
    if (problems.length > 0) {
        throw new EngineExtrasError(`the extras cannot be built:\n${problems.join('\n')}`);
    }
    const code = finishedCode(iife.code);
    const integrity = subresourceIntegrity(Buffer.from(code));
    return { extra, fileName: extraFileName(extra.name, integrity), integrity, code, map: String(iife.map), modules };
}

/** Builds every extra (in order: the files and the generated module are the same on every machine). */
export async function buildExtras(options: EngineExtrasOptions): Promise<BuiltExtra[]> {
    const keys = importedKeys(options.importsModule, readFileSync(options.importsModule, 'utf8'));
    const globals = options.extras.map((extra) => extra.global);
    if (keys.join() !== globals.join()) {
        throw new EngineExtrasError(
            `${options.importsModule} names ${keys.join(', ')}; the build makes ${globals.join(', ')}: the same keys, in order`,
        );
    }
    const hostExports = new Map(
        options.host.map((host) => [host.specifier, exportedNames(host.module, readFileSync(host.module, 'utf8'))]),
    );
    const built: BuiltExtra[] = [];
    for (const extra of options.extras) {
        built.push(await buildExtra(options, extra, hostExports));
    }
    return built;
}

interface EmitContext {
    emitFile(file: { readonly type: 'asset'; readonly fileName: string; readonly source: string }): string;
}

/** The plugin's hooks, typed by what they do (the engine's config passes it to Vite). */
export interface EngineExtrasPlugin {
    readonly name: string;
    buildStart(): Promise<void>;
    load(id: string): string | null;
    generateBundle(this: EmitContext): void;
    /** Every module the extras carry, for the third-party notices. */
    modules(): string[];
}

/** The Vite plugin of the engine's build (`packages/engine/vite.config.ts`). */
export function engineExtrasPlugin(options: EngineExtrasOptions): EngineExtrasPlugin {
    let started: Promise<BuiltExtra[]> | null = null;
    let built: readonly BuiltExtra[] = [];
    return {
        name: 'hcm-engine-extras',
        async buildStart() {
            started ??= buildExtras(options);
            built = await started;
        },
        load(id) {
            return id.split('?')[0] === options.importsModule ? importsModuleCode(options.runtimeModule, options.hostKey, built) : null;
        },
        generateBundle() {
            for (const item of built) {
                this.emitFile({ type: 'asset', fileName: item.fileName, source: item.code });
                this.emitFile({ type: 'asset', fileName: `${item.fileName}.map`, source: item.map });
            }
        },
        modules: () => built.flatMap((item) => item.modules),
    };
}
