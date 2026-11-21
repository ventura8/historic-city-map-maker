/**
 * The page's extras loader (packages/engine/src/extras/runtime.ts): the engine's folder, the host, and one loader for the
 * page, made the first time an extra is wanted (so both tests share it, as a page would).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EXTRAS_HOST_GLOBAL, type ExtrasHost } from '../../src/extras/host.js';
import { loadExtra, setExtrasBase } from '../../src/extras/runtime.js';
import { FakeDocument } from './fake-page.js';

const page = new FakeDocument();

beforeAll(() => {
    vi.stubGlobal('document', page);
});

afterAll(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, EXTRAS_HOST_GLOBAL);
});

describe('loadExtra', () => {
    it('happyPath_loadsFromTheEngineFolderAndRegistersOnTheHost', async () => {
        setExtrasBase('https://example.org/engine/');

        const loading = loadExtra({
            host: 'v2_1_0_beta_3',
            global: 'fieldSdk',
            file: 'extra-field-sdk-12345678.js',
            integrity: 'sha384-f',
        });
        const hosts = Reflect.get(globalThis, EXTRAS_HOST_GLOBAL) as Record<string, ExtrasHost>;
        expect(Object.keys(hosts)).toEqual(['v2_1_0_beta_3']);
        const [host] = Object.values(hosts) as [ExtrasHost];
        host.extras['fieldSdk'] = { fieldSdk: 'chunk' };
        host.ready['fieldSdk'] = true;
        page.scripts.at(-1)?.fire('load');

        await expect(loading).resolves.toEqual({ fieldSdk: 'chunk' });
        expect(page.scripts.at(-1)?.src).toBe('https://example.org/engine/extra-field-sdk-12345678.js');
    });

    it('badPath_aRefusedScriptRejectsTheWish', async () => {
        const loading = loadExtra({
            host: 'v2_1_0_beta_3',
            global: 'gamepad',
            file: 'extra-gamepad-12345678.js',
            integrity: 'sha384-wrong',
        });
        page.scripts.at(-1)?.fire('error');

        await expect(loading).rejects.toThrow('could not be loaded');
        expect(page.scripts.at(-1)?.removed).toBe(true);
    });
});
