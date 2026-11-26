/**
 * The colour library of `@hcm/ui/dynamic-color` (`themeFromSeed`, `contrastIssues`), loaded once the page starts
 * (`docs/research/M2c-interfaces.md` §2.2: `services.theme`). The entry starts the load in the browser; nothing in the
 * admin's module graph imports the library statically, because Node (the admin's tests) cannot load it. Settings asks
 * for a theme long after the page started, by when the load has finished: the admin's bundle carries the library.
 */
import type * as DynamicColor from '@hcm/ui/dynamic-color';

type ColorLibrary = Pick<typeof DynamicColor, 'themeFromSeed' | 'contrastIssues'>;

let library: ColorLibrary | null = null;

/** Loads the library (`() => import('@hcm/ui/dynamic-color')` in the entry). */
export async function loadColor(load: () => Promise<ColorLibrary>): Promise<void> {
    library = await load();
}

/** The library once loaded; a call before is a programming error. */
export function colorLibrary(): ColorLibrary {
    if (library === null) {
        throw new Error('the colour library is not loaded yet');
    }
    return library;
}

/** `themeFromSeed` of the loaded library (`ContentServices.theme`). */
export function themeFromSeed(seed: string): DynamicColor.ThemeTokenSet {
    return colorLibrary().themeFromSeed(seed);
}

/** `contrastIssues` of the loaded library (Settings' check of a seed colour's tokens). */
export function contrastIssuesOf(
    tokens: Parameters<ColorLibrary['contrastIssues']>[0],
    minimum: number,
): ReturnType<ColorLibrary['contrastIssues']> {
    return colorLibrary().contrastIssues(tokens, minimum);
}
