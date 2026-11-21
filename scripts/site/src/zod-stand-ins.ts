import type { Plugin } from 'vite';

/**
 * zod's classic schemas import its JSON Schema conversion for `toJSONSchema()`, Standard Schema's `jsonSchema` and the
 * derived getters (`minLength`, `maxValue`, `isInt`, `format`), none of which the admin or the engine calls: those two imports
 * resolve to a stand-in that refuses (`packages/admin/src/vendor/zod-json-schema-unsupported.ts`, DECISIONS-for-review.md
 * §86 for the admin, §100a for the engine), and the real modules are no longer reachable. zod's classic schemas also install
 * its English messages, which neither app shows (an issue reaches a page as its `validation.*` code): both builds resolve
 * them to a stand-in with no messages (`zod-locale-none.ts`; §93 for the admin, §120a for the engine). Every other importer
 * keeps zod's own modules.
 */
const ZOD_CLASSIC_SCHEMAS = /[\\/]zod[\\/]v4[\\/]classic[\\/]schemas\.js$/;

/** The stand-ins of one build, as absolute paths (each config names its own, so the tools see the files it uses). */
export interface ZodStandIns {
    /** Stands in for `json-schema-processors.js` and `to-json-schema.js`. */
    readonly jsonSchema: string;
    /** Stands in for `locales/en.js`; zod's messages stay without it. */
    readonly messages?: string;
}

function standInFor(source: string, standIns: ZodStandIns): string | undefined {
    const table: Readonly<Record<string, string | undefined>> = {
        '../core/json-schema-processors.js': standIns.jsonSchema,
        '../core/to-json-schema.js': standIns.jsonSchema,
        '../locales/en.js': standIns.messages,
    };
    return Object.hasOwn(table, source) ? table[source] : undefined;
}

/** Where `source`, imported by `importer`, resolves instead; null to leave it to the bundler. */
export function zodStandIn(source: string, importer: string | undefined, standIns: ZodStandIns): string | null {
    const classic = importer !== undefined && ZOD_CLASSIC_SCHEMAS.test(importer);
    return (classic ? standInFor(source, standIns) : undefined) ?? null;
}

/** The Vite plugin of the admin's and the engine's builds. */
export function zodStandInsPlugin(standIns: ZodStandIns): Plugin {
    return {
        name: 'hcm-zod-stand-ins',
        enforce: 'pre',
        resolveId: (source, importer) => zodStandIn(source, importer, standIns),
    };
}
