/**
 * The admin's stand-in for zod's JSON Schema conversion (`src/vendor/zod-json-schema-unsupported.ts`,
 * DECISIONS-for-review.md §86): it names every function zod's classic schemas import from the two modules it replaces, and
 * each refuses when called.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as standIn from '../../src/vendor/zod-json-schema-unsupported.js';

/** zod's classic schemas module, as the admin's build bundles it. */
function zodClassicSchemas(): string {
    const require = createRequire(import.meta.url);
    return readFileSync(join(dirname(require.resolve('zod')), 'v4', 'classic', 'schemas.js'), 'utf8');
}

describe("the zod JSON Schema stand-in", () => {
    it('happyPath_itNamesEveryFunctionZodsClassicSchemasImport', () => {
        const source = zodClassicSchemas();
        const used = new Set([...source.matchAll(/processors\.(\w+)\(/g)].map((found) => found[1] ?? ''));
        const imported = /import \{ ([\w, ]+) \} from "\.\.\/core\/to-json-schema\.js"/.exec(source)?.[1]?.split(', ') ?? [];

        expect(used.size).toBeGreaterThan(30);
        expect(imported).toEqual(['createStandardJSONSchemaMethod', 'createToJSONSchemaMethod']);
        expect([...used, ...imported].filter((name) => !(name in standIn))).toEqual([]);
    });

    it('badPath_aConversionOrAGetterIsRefusedWithWhy', () => {
        const method = standIn.createToJSONSchemaMethod();

        expect(() => method()).toThrow('no JSON Schema conversion (DECISIONS-for-review.md §86, §100)');
        expect(() => standIn.createStandardJSONSchemaMethod()()).toThrow('JSON Schema');
        expect(() => standIn.aggregateChecks()).toThrow('JSON Schema');
        expect(() => standIn.stringProcessor()).toThrow('JSON Schema');
    });
});
