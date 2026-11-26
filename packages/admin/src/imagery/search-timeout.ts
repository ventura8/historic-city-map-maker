/**
 * The search's timeout: just over the server's 540 s (`CALLABLE_TIMEOUT_SECONDS` of `functions/src/api/callable.ts`,
 * CR-M3-22), past the SDK's 70 s default, so a first harvest is not cut short in the browser. A leaf module: the Imagery
 * area and Settings' imagery section (M8) both search.
 */
export const IMAGERY_SEARCH_TIMEOUT_MS = 550_000;
