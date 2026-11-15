import { describe, expect, it } from 'vitest';

import type { StartPagePort } from '@hcm/ui/start';

import { autoStart, browserDeps } from '../../src/start/index.js';
import { testLog } from '../app/fakes.js';

/** The entry in Node: its ports over plain objects; the start needs a document, so importing it does nothing. */
function fakeWindow(): Parameters<typeof browserDeps>[0] & { replaced: string[]; assigned: string[] } {
    const replaced: string[] = [];
    const assigned: string[] = [];
    return {
        replaced,
        assigned,
        location: {
            origin: 'https://start.example.test',
            pathname: '/',
            search: '?lang=ro&test=abc',
            hash: '#access_token=x',
            hostname: 'start.example.test',
            reload: () => undefined,
            assign: (url: string) => assigned.push(url),
        },
        history: { replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) },
        navigator: { languages: ['ro'] },
        crypto: { randomUUID: () => 'uuid', subtle: { digest: () => Promise.resolve(new Uint8Array([171]).buffer) } },
        sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, length: 0, key: () => null },
        localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, length: 0, key: () => null },
        fetch: () => Promise.resolve(new Response('{}')),
        setTimeout: () => 0,
        clearTimeout: () => undefined,
    } as never;
}

describe('the start entry', () => {
    it('happyPath_theBrowsersPartsBecomeTheControllersPorts', async () => {
        const win = fakeWindow();
        const deps = browserDeps(win, testLog().log);
        expect(deps.baseUrl).toBe('https://start.example.test/');
        expect(deps.fragment()).toBe('#access_token=x');
        deps.clearFragment();
        expect(win.replaced).toEqual(['/?lang=ro&test=abc']);
        deps.assign('https://accounts.google.com/');
        expect(win.assigned).toEqual(['https://accounts.google.com/']);
        expect(deps.random()).toBe('uuid');
        expect(deps.authorizeUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(await deps.tools.digest(new Uint8Array())).toBe('ab');
        expect(deps).not.toHaveProperty('testId');
        await expect((await deps.fetch('x')).text()).resolves.toBe('{}');
        await expect((await deps.tools.fetch('x')).text()).resolves.toBe('{}');
    });

    it('happyPath_theElementJoinsThePageAndGetsItsPort', async () => {
        const defined = new Map<string, CustomElementConstructor>();
        const registry = {
            get: (name: string) => defined.get(name),
            define: (name: string, element: CustomElementConstructor) => defined.set(name, element),
        };
        const element = {
            port: undefined as
                { problems(): unknown; censusBox(): unknown; view: unknown; subscribe(listener: () => void): () => void } | undefined,
        };
        const doc = { querySelector: () => null, body: { appendChild: () => element }, createElement: () => element };
        autoStart({ document: doc, customElements: registry } as never, fakeWindow(), testLog().log);
        const { port } = element;
        expect(defined.has('hcm-start-page')).toBe(true);
        expect(port?.problems()).toEqual({ cityId: null, area: null, projectId: null, ready: false });
        expect(port?.censusBox()).toBeNull();
        expect(port?.view).toMatchObject({ locale: 'ro' });
        expect(port?.subscribe(() => undefined)).toEqual(expect.any(Function));
        await new Promise((resolve) => setImmediate(resolve));
    });

    it('happyPath_theFormsRulesReachThePage', () => {
        const defined = new Map<string, CustomElementConstructor>();
        const registry = {
            get: (name: string) => defined.get(name),
            define: (name: string, element: CustomElementConstructor) => defined.set(name, element),
        };
        const element = { port: undefined as unknown as StartPagePort };
        const doc = { querySelector: () => element };
        autoStart({ document: doc, customElements: registry } as never, fakeWindow(), testLog().log);
        const { port } = element;
        expect(port.problems().ready).toBe(false);
        port.intents.setName('Bacău');
        expect(port.problems().ready).toBe(true);
        port.intents.setCityId('a');
        expect(port.problems().ready).toBe(false);
        port.intents.setCityId('bacau');
        port.intents.setProjectId('NU E BUN');
        expect(port.problems().ready).toBe(false);
        port.intents.setCreate(false);
        port.intents.setPicked('harta-bacau');
        expect(port.problems().ready).toBe(true);
    });

    it('e2e_theConsentIsTheStandInsInTheTestsPartition', () => {
        const deps = browserDeps(fakeWindow(), testLog().log, true);
        expect(deps.authorizeUrl).toBe('http://127.0.0.1:4311/__oauth/authorize');
        expect(deps.testId).toBe('abc');
    });

    it('edge_withoutADocumentNothingStarts', () => {
        expect(() => {
            autoStart({}, fakeWindow(), testLog().log);
            autoStart({ document: {} as Document }, fakeWindow(), testLog().log);
        }).not.toThrow();
    });
});
