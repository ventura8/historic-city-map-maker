/**
 * The engine's side-loaded parts (the owner's "Load extras on demand", 2026-11-09; docs/ENGINE_API.md → *Side-loaded
 * parts*). A part is a small IIFE beside the engine that the engine adds as a `<script>` with its Subresource Integrity
 * when it is first needed: today `engine.extras.js`, the full-size view. Two plugins:
 *
 * - `sidePartKitPlugin` builds the part (`packages/engine/vite.part.config.ts`): every import of a module outside the
 *   part's own files becomes the one external `KIT_ID`, read from the global the engine sets (`extras-loader.ts`), so the
 *   part carries no second Lit and no texts;
 * - `sidePartPlugin` builds the engine (`packages/engine/vite.config.ts`): it reads the built part, writes its integrity
 *   into the constant the engine loads it with, and emits the part next to the engine's two builds.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The external id every import from outside the part resolves to. */
export const KIT_ID = 'hcm-side-part-kit';

/** A module id without its query (`?used`, `?raw`). */
function withoutQuery(id: string): string {
    const query = id.indexOf('?');
    return query < 0 ? id : id.slice(0, query);
}

/** `sha384-…` of `bytes`, the value of a `<script integrity>`. */
export function sriOf(bytes: Uint8Array): string {
    return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

interface Resolved {
    readonly id: string;
}

interface ResolveContext {
    resolve(source: string, importer?: string, options?: { readonly skipSelf?: boolean }): Promise<Resolved | null>;
}

/** The part's build: an import from a module of its own stays; any other becomes the external kit. */
export function sidePartKitPlugin(own: (id: string) => boolean): {
    readonly name: string;
    readonly enforce: 'pre';
    resolveId(this: ResolveContext, source: string, importer: string | undefined): Promise<{ id: string; external: true } | null>;
} {
    return {
        name: 'hcm-side-part-kit',
        enforce: 'pre',
        async resolveId(source, importer) {
            if (importer === undefined) {
                return null;
            }
            const resolved = await this.resolve(source, importer, { skipSelf: true });
            return resolved !== null && own(withoutQuery(resolved.id)) ? null : { id: KIT_ID, external: true };
        },
    };
}

/** Where the built part is, the constant's module and the name the engine's builds serve the part under. */
export interface SidePartOptions {
    readonly built: string;
    readonly constantModule: string;
    readonly fileName: string;
}

/** The empty integrity in the sources (`packages/engine/src/extras-part.ts`), which the build replaces. */
export const EMPTY_INTEGRITY = "_INTEGRITY = '';";

interface EmitContext {
    emitFile(file: { readonly type: 'asset'; readonly fileName: string; readonly source: Uint8Array }): string;
}

/** Writes the part's integrity into `code` (the constant's module); throws when the empty constant is not there. */
export function withIntegrity(code: string, integrity: string): string {
    if (!code.includes(EMPTY_INTEGRITY)) {
        throw new Error(`side part: no ${EMPTY_INTEGRITY} to fill`);
    }
    return code.replace(EMPTY_INTEGRITY, `_INTEGRITY = '${integrity}';`);
}

/** The engine's build: the part's integrity in its constant, and the part emitted once (with the ES module build). */
export function sidePartPlugin(options: SidePartOptions): {
    readonly name: string;
    readonly enforce: 'pre';
    buildStart(): void;
    transform(code: string, id: string): { readonly code: string; readonly map: null } | null;
    generateBundle(this: EmitContext, output: { readonly format?: string }): void;
} {
    let bytes = new Uint8Array();
    return {
        name: 'hcm-side-part',
        enforce: 'pre',
        buildStart() {
            bytes = new Uint8Array(readFileSync(options.built));
        },
        transform(code, id) {
            return withoutQuery(id) === options.constantModule ? { code: withIntegrity(code, sriOf(bytes)), map: null } : null;
        },
        generateBundle(output) {
            if (output.format === 'es') {
                this.emitFile({ type: 'asset', fileName: options.fileName, source: bytes });
            }
        },
    };
}
