/**
 * The side-load of the full-size view (docs/ENGINE_API.md → *Side-loaded parts*): one `<script>` with its integrity, the
 * kit handed over first, a failed load forgotten; and the kit names everything the part imports from outside itself.
 */
import { describe, expect, it } from 'vitest';

import * as kit from '../../src/viewer/extras-kit.js';
import { EXTRAS_KIT_GLOBAL, sideLoadExtras } from '../../src/viewer/extras-loader.js';
import lightboxSource from '../../src/viewer/hcm-lightbox.ts?raw';
import stylesSource from '../../src/viewer/lightbox-styles.ts?raw';
import menuSource from '../../src/viewer/map-menu.ts?raw';
import aboutSource from '../../src/viewer/hcm-about-dialog.ts?raw';
import helpSource from '../../src/viewer/shortcuts-help.ts?raw';

/** A registry with nothing defined, so the loader adds the script. */
const EMPTY_REGISTRY = { get: () => undefined } as unknown as CustomElementRegistry;

function part(url: string, integrity: string): { url: string; integrity: string } {
    return { url, integrity };
}

describe('sideLoadExtras', () => {
    it('happyPath_aFailedLoadIsForgottenThenOneScriptWithItsIntegrityAndTheKitFirst', async () => {
        const doc = document.implementation.createHTMLDocument('part');
        const failing = sideLoadExtras(doc, part('https://cdn.example.org/missing.js', ''), EMPTY_REGISTRY);
        doc.head.querySelector('script')?.dispatchEvent(new Event('error'));

        await expect(failing).rejects.toThrow('the full-size view did not load');
        expect(doc.head.querySelectorAll('script')).toHaveLength(0);
        const integrity = `sha384-${'A'.repeat(64)}`;
        const loading = sideLoadExtras(doc, part('https://cdn.example.org/engine.extras.js', integrity), EMPTY_REGISTRY);
        const again = sideLoadExtras(doc, part('https://cdn.example.org/other.js', ''), EMPTY_REGISTRY);
        const script = doc.head.querySelector('script');
        script?.dispatchEvent(new Event('load'));

        await expect(Promise.all([loading, again])).resolves.toEqual([undefined, undefined]);
        expect(doc.head.querySelectorAll('script')).toHaveLength(1);
        expect([script?.integrity, script?.crossOrigin]).toEqual([integrity, 'anonymous']);
        expect((globalThis as Record<string, unknown>)[EXTRAS_KIT_GLOBAL]).toBe(kit);
    });

    it('badPath_onceLoadedNoSecondScriptAndAnUnsignedPartHasNoIntegrity', async () => {
        const doc = document.implementation.createHTMLDocument('part');

        await sideLoadExtras(doc, part('https://cdn.example.org/engine.extras.js', ''), EMPTY_REGISTRY);

        expect(doc.head.querySelectorAll('script')).toHaveLength(0);
    });

    it('badPath_anAlreadyDefinedElementLoadsNothing', async () => {
        const doc = document.implementation.createHTMLDocument('part');
        const defined = { get: () => HTMLElement } as unknown as CustomElementRegistry;

        await sideLoadExtras(doc, part('https://cdn.example.org/engine.extras.js', ''), defined);

        expect(doc.head.querySelectorAll('script')).toHaveLength(0);
    });
});

/** The names `source` imports from modules other than the part's own (`./zoom.js`, `./lightbox-styles.js`). */
function kitImports(source: string): string[] {
    const own = new Set(['./zoom.js', './lightbox-styles.js', './hcm-lightbox.js', './map-menu-trigger.js', './shortcuts-help.js']);
    const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)];
    return imports
        .filter((match) => !own.has(match[2] ?? ''))
        .flatMap((match) => (match[1] ?? '').split(','))
        .map((name) => name.trim())
        .filter((name) => name !== '' && !name.startsWith('type '));
}

describe('extras-kit', () => {
    it('happyPath_everyNameThePartImportsIsInTheKit', () => {
        const needed = [
            ...kitImports(lightboxSource),
            ...kitImports(stylesSource),
            ...kitImports(menuSource),
            ...kitImports(aboutSource),
            ...kitImports(helpSource),
        ];

        expect(needed.length).toBeGreaterThan(10);
        expect(needed.filter((name) => !(name in kit))).toEqual([]);
    });
});
