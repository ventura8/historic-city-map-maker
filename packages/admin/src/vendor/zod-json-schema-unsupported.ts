/**
 * The admin's stand-in for zod's JSON Schema conversion (`zod/v4/core/json-schema-processors.js` and
 * `to-json-schema.js`), which the admin's and the engine's builds resolve zod's classic schemas' two imports of them to
 * (`scripts/site/src/zod-stand-ins.ts`; `docs/research/DECISIONS-for-review.md` §86, after §65k's `re2js`, and §100).
 * Every zod schema carries a `toJSONSchema()` method, Standard Schema's `jsonSchema` and the derived getters (`minLength`,
 * `maxValue`, `isInt`, `format`), whose code is only reached when they are called: the admin and the engine validate with
 * their schemas and never convert one to JSON Schema nor read those getters. The real modules were 18 KB of the admin's
 * first script and about 6 KB gzip of the engine's builds. Each stand-in throws when called, so
 * a future use fails loudly in the unit and e2e tests (the e2e admin is built with this stand-in) rather than quietly.
 */

/** Every stand-in: refuses, naming what the admin and the engine do not do. */
function unsupported(): never {
    throw new Error('no JSON Schema conversion (DECISIONS-for-review.md §86, §100)');
}

/** `createToJSONSchemaMethod` and `createStandardJSONSchemaMethod` make a method; the method refuses when called. */
export function createToJSONSchemaMethod(): () => never {
    return unsupported;
}
export const createStandardJSONSchemaMethod = createToJSONSchemaMethod;

export const aggregateChecks = unsupported;
export const anyProcessor = unsupported;
export const arrayProcessor = unsupported;
export const bigintProcessor = unsupported;
export const booleanProcessor = unsupported;
export const catchProcessor = unsupported;
export const customProcessor = unsupported;
export const dateProcessor = unsupported;
export const defaultProcessor = unsupported;
export const enumProcessor = unsupported;
export const fileProcessor = unsupported;
export const functionProcessor = unsupported;
export const intersectionProcessor = unsupported;
export const lazyProcessor = unsupported;
export const literalProcessor = unsupported;
export const mapProcessor = unsupported;
export const nanProcessor = unsupported;
export const neverProcessor = unsupported;
export const nonoptionalProcessor = unsupported;
export const nullableProcessor = unsupported;
export const nullProcessor = unsupported;
export const numberProcessor = unsupported;
export const objectProcessor = unsupported;
export const optionalProcessor = unsupported;
export const pipeProcessor = unsupported;
export const prefaultProcessor = unsupported;
export const promiseProcessor = unsupported;
export const readonlyProcessor = unsupported;
export const recordProcessor = unsupported;
export const setProcessor = unsupported;
export const stringProcessor = unsupported;
export const successProcessor = unsupported;
export const symbolProcessor = unsupported;
export const templateLiteralProcessor = unsupported;
export const transformProcessor = unsupported;
export const tupleProcessor = unsupported;
export const undefinedProcessor = unsupported;
export const unionProcessor = unsupported;
export const unknownProcessor = unsupported;
export const voidProcessor = unsupported;
