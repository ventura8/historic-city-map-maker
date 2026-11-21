/**
 * The extras as the sources import them (packages/engine/src/extras/imports.ts): each key resolves to the module the
 * build makes its extra from (`packages/engine/vite.config.ts`), with the export its caller reads.
 */
import { describe, expect, it } from 'vitest';

import { extraImports } from '../../src/extras/imports.js';

describe('extraImports', () => {
    it('happyPath_eachExtraIsTheModuleItsCallerReads', async () => {
        expect(Object.keys(extraImports)).toEqual(['compare', 'gamepad', 'firebaseSdk', 'fieldSdk']);
        expect((await extraImports.compare()).compareModule.startCompare).toBeTypeOf('function');
        expect((await extraImports.gamepad()).startGamepad).toBeTypeOf('function');
        expect((await extraImports.firebaseSdk()).firebaseSdk.logEvent).toBeTypeOf('function');
        expect((await extraImports.fieldSdk()).fieldSdk.createGuard).toBeTypeOf('function');
    }, 30_000);
});
