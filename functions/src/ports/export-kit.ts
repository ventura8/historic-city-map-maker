/** One file of the export kit: its path below the kit's folder, its size, and its bytes when the zip reaches it. */
export interface KitFile {
    /** `engine.iife.js`, `fonts/roboto-flex-latin-wght.woff2`, ... (below `engine/`). */
    readonly path: string;
    readonly bytes: number;
    open(): AsyncIterable<Uint8Array>;
}

/**
 * What a static export carries besides the city's own files (M5, `docs/research/M5-interfaces.md` §5.1, §5.3): the
 * starter kit's page and README, and the engine the deployed functions were built with. `functions/build.mjs` copies
 * them into `functions/dist/export-kit/` with `kit.json` (the engine's version and its files); adapter
 * `functions/src/adapters/export-kit.ts` reads that folder, the tests pass a fake.
 */
export interface ExportKit {
    /** `ENGINE_VERSION` of the engine in `engine/`, as the build recorded it. */
    engineVersion(): Promise<string>;
    /** The starter kit's `index.html` and `README.md` as committed (`templates/starter-kit/`). */
    texts(): Promise<{ readonly page: string; readonly readme: string }>;
    /**
     * The engine's files without source maps: `engine.iife.js` and its extras (`extra-<name>-<hash>.js`), the side-loaded
     * `engine.extras.js`, `engine.css`, `fonts/…`, `i18n/…`, `THIRD_PARTY_NOTICES.txt`.
     */
    engineFiles(): Promise<readonly KitFile[]>;
}
