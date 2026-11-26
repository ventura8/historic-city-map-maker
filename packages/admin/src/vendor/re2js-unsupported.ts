/**
 * The admin's stand-in for the `re2js` package, which `packages/admin/vite.config.ts` resolves to this module
 * (`docs/research/DECISIONS-for-review.md` §65k). The Firestore SDK imports re2js only to evaluate the `like`,
 * `regex_contains` and `regex_match` functions of Firestore Pipelines in the browser, which the admin never runs (it
 * listens to documents and queries); each of the SDK's three call sites catches what `compile` throws and answers an
 * error value with a warning. The real package was 144 KB of the admin's first script, about 36 KB gzip.
 */
export const RE2JS = {
    compile(pattern: string): never {
        throw new Error(`the admin does not evaluate Firestore Pipelines' regular expressions (${pattern})`);
    },
};
