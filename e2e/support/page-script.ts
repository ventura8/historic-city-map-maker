/**
 * Installs the in-page probes of the tour's checkers in the page (e2e/support/dom-walk.ts and the probes built on it) and
 * calls them there. `page.evaluate(fn)` serializes one function, which would have to hold every helper inside its own
 * body; the checkers instead install a set of small named helpers once per page load as a library
 * (`window.hcmLibraries[key]`, one expression that declares them all), then call one of them by name with a small
 * argument: every later call sends only the name, and the trace of a failing test records a few bytes per call instead
 * of the helpers' source. Playwright evaluates over the DevTools protocol, which the page's CSP does not govern (no
 * `eval` or `new Function` runs in the page). Every helper must be a `function` declaration that references only browser
 * globals and other helpers of the same set; Vitest calls the same functions directly on synthetic DOM fixtures
 * (e2e/test/), so what runs in the page is what the unit tests measure.
 */

/** A function declaration sent to the page (its source is `function name(...) {...}`). */
export type PageFunction = (...args: never[]) => unknown;

/** What `callLibrary` answers: the entry's result, or that the page has no such library yet (a new page). */
export type LibraryAnswer = { readonly missing: true } | { readonly result: unknown };

/** The name the page keeps a set of helpers under: a hash of their names (one library per set). */
export function libraryKey(helpers: readonly PageFunction[]): string {
    let hash = 5381;
    for (const character of helpers.map((helper) => helper.name).join(',')) {
        hash = Math.imul(hash, 33) ^ character.charCodeAt(0);
    }
    return `hcm-${(hash >>> 0).toString(16)}`;
}

/** The expression that declares `helpers` and installs them in the page as the library `libraryKey(helpers)`. */
export function libraryScript(helpers: readonly PageFunction[]): string {
    const unique = [...new Set(helpers)];
    const declarations = unique.map((helper) => helper.toString()).join('\n');
    const table = unique.map((helper) => helper.name).join(', ');
    const key = JSON.stringify(libraryKey(helpers));
    return `(() => {\n${declarations}\nconst scope = window;\nscope.hcmLibraries = scope.hcmLibraries ?? {};\nscope.hcmLibraries[${key}] = { ${table} };\nreturn true;\n})()`;
}

/** Runs in the page, serialized by Playwright: calls `name(arg)` of the installed library `key`, awaiting a promise. */
export async function callLibrary([key, name, arg]: readonly [string, string, unknown]): Promise<LibraryAnswer> {
    type Library = Record<string, ((value: unknown) => unknown) | undefined>;
    const libraries = (window as unknown as { hcmLibraries?: Record<string, Library | undefined> }).hcmLibraries;
    const entry = libraries?.[key]?.[name];
    return entry === undefined ? { missing: true } : { result: await entry(arg) };
}
