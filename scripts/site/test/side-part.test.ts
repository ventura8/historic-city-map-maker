/**
 * The engine's side-loaded parts (`scripts/site/src/side-part.ts`): the part's build turns every outside import into the
 * kit; the engine's build writes the part's integrity into its constant and emits the part once.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMPTY_INTEGRITY, KIT_ID, sidePartKitPlugin, sidePartPlugin, sriOf, withIntegrity } from '../src/side-part.js';

const OWN = '/repo/packages/ui/src/viewer/hcm-lightbox.ts';

function resolver(resolved: string | null) {
    return { resolve: () => Promise.resolve(resolved === null ? null : { id: resolved }) };
}

describe('sidePartKitPlugin', () => {
    const plugin = sidePartKitPlugin((id) => id === OWN);

    it('happyPath_anOwnModuleStaysAndAnyOtherIsTheKit', async () => {
        await expect(plugin.resolveId.call(resolver(`${OWN}?x`), './hcm-lightbox.js', '/repo/entry.ts')).resolves.toBeNull();
        await expect(plugin.resolveId.call(resolver('/repo/node_modules/lit/index.js'), 'lit', OWN)).resolves.toEqual({
            id: KIT_ID,
            external: true,
        });
    });

    it('badPath_theEntryAndAnUnresolvedImport', async () => {
        await expect(plugin.resolveId.call(resolver(OWN), 'entry.ts', undefined)).resolves.toBeNull();
        await expect(plugin.resolveId.call(resolver(null), 'ghost', OWN)).resolves.toEqual({ id: KIT_ID, external: true });
    });
});

describe('sidePartPlugin', () => {
    it('happyPath_theIntegrityIsWrittenAndThePartEmittedOnceWithTheModuleBuild', () => {
        const folder = mkdtempSync(join(tmpdir(), 'side-part-'));
        const built = join(folder, 'engine.extras.js');
        writeFileSync(built, 'console;');
        const plugin = sidePartPlugin({ built, constantModule: '/repo/src/extras-part.ts', fileName: 'engine.extras.js' });
        const emitted: unknown[] = [];
        const context = {
            emitFile: (file: unknown) => {
                emitted.push(file);
                return 'id';
            },
        };

        plugin.buildStart();
        const code = plugin.transform(`export const EXTRAS_PART${EMPTY_INTEGRITY}`, '/repo/src/extras-part.ts?used');
        plugin.generateBundle.call(context, { format: 'iife' });
        plugin.generateBundle.call(context, { format: 'es' });

        expect(code?.code).toBe(`export const EXTRAS_PART_INTEGRITY = '${sriOf(new TextEncoder().encode('console;'))}';`);
        expect(plugin.transform('x', '/repo/src/other.ts')).toBeNull();
        expect(emitted).toEqual([{ type: 'asset', fileName: 'engine.extras.js', source: new TextEncoder().encode('console;') }]);
    });

    it('badPath_aModuleWithoutTheEmptyConstantFailsTheBuild', () => {
        expect(() => withIntegrity('export const X = 1;', 'sha384-x')).toThrow('side part: no');
        expect(sriOf(new Uint8Array())).toBe('sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb');
    });
});
