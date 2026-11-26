/**
 * The admin's stand-in for zod's English messages (`zod/v4/locales/en.js`), which the admin's build, and since §120a the
 * engine's, resolves zod's classic schemas' import of them to (`scripts/site/src/zod-stand-ins.ts`,
 * `docs/research/DECISIONS-for-review.md` §93, after §86). Both read an issue's `validation.*` code, never the sentence zod
 * would write: with no `localeError`, zod's own "Invalid input" is what an uncoded issue says in a log. The real module was 1.1 KB gzip of the admin's first script.
 */
export default function noMessages(): Record<string, never> {
    return {};
}
