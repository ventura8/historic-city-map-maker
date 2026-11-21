/**
 * A games console's browser (docs/research/viewer-input.md §6): the Xbox's Edge names `Xbox` in its user agent, the
 * PlayStation's WebKit windows `PlayStation`. Only the no-WebGL message reads it, to say what the console lacks and
 * where the map works instead; nothing else changes on a console, but analytics counts it (`input_device`, §200).
 */
export function isGameConsole(userAgent: string): boolean {
    return /\b(?:Xbox|PlayStation)\b/.test(userAgent);
}

/** On a console's browser, the store's `input_device` event (once a page; the store dedupes). */
export function reportConsole(userAgent: string, store: { logInput?(device: 'console'): void }): void {
    if (isGameConsole(userAgent)) {
        store.logInput?.('console');
    }
}
