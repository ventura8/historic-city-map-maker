// "Use this computer" (finding 72 of 2026-11-02, `packages/admin/src/worker/local.ts`; finding 73 of 2026-11-03: the starter
// files are links to the server's `worker.starter`, whose answer one HEAD checks): the auto-pair over the worker's local
// `GET /state` and `POST /pair`, Stop using this computer and the Advanced code.
import { describe, expect, it } from 'vitest';

import {
    createLocal,
    functionsBaseFor,
    LOCAL_KEY,
    LOCAL_WORKER,
    LocalComputer,
    osOf,
    PROBE_MS,
    starterLinks,
} from '../../src/worker/local.js';
import { failure } from '../app/fakes.js';
import { CITY, contentWorld, type ContentWorld } from '../content/world.js';

const PROJECT = 'demo-hcm';
const CODE = 'abcdefghijklmnopqrstuvwxyz';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const BASE = 'https://us-central1-demo-hcm.cloudfunctions.net';

interface Sent {
    readonly url: string;
    readonly init: RequestInit | undefined;
}

/** The page's `fetch` as the tests answer it: the server's `worker.starter`, and this computer's worker. */
class FakeNet {
    readonly sent: Sent[] = [];
    /** The worker's `GET /state` answer; null: nothing answers on this computer. */
    state: Record<string, unknown> | null = null;
    /** Whether the server makes the starter file. */
    starter = true;

    readonly fetch = (url: string, init?: RequestInit): Promise<Response> => {
        this.sent.push({ url, init });
        if (url.startsWith(`${LOCAL_WORKER}/`)) {
            return this.#worker(url);
        }
        return Promise.resolve(new Response(null, { status: this.starter ? 200 : 404 }));
    };

    #worker(url: string): Promise<Response> {
        if (this.state === null) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve(url.endsWith('/pair') ? new Response('{}', { status: 202 }) : Response.json(this.state));
    }

    to(path: string): Sent[] {
        return this.sent.filter((sent) => sent.url === `${LOCAL_WORKER}${path}`);
    }
}

function answer(changes: Record<string, unknown> = {}): Record<string, unknown> {
    return { workerId: 'w-0123456789abcdef', signedIn: false, pairable: true, city: CITY, project: PROJECT, ...changes };
}

function localOf(world: ContentWorld, net: FakeNet, userAgent = LINUX): LocalComputer {
    world.callables.answer('worker.pairCode', () => ({ code: CODE, expiresAt: '2025-10-09T08:10:00.000Z' }));
    world.callables.answer('worker.revoke', () => ({ revoked: true }));
    return new LocalComputer(world.services, { project: PROJECT, functionsBase: BASE, fetch: net.fetch, userAgent });
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

describe("this computer's starter file", () => {
    it('happyPath_theSystemIsTheBrowsers', () => {
        expect([osOf(LINUX), osOf(WINDOWS), osOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)')]).toEqual(['linux', 'windows', 'mac']);
    });

    it('happyPath_theLinksAreTheServersStarterFunctionForTheCityAndSystem', () => {
        expect(functionsBaseFor(PROJECT, false)).toBe(BASE);
        expect(functionsBaseFor(PROJECT, true)).toBe('http://127.0.0.1:5001/demo-hcm/us-central1');
        expect(starterLinks(BASE, CITY, 'windows')).toEqual({
            install: { url: `${BASE}/worker-starter?city=${CITY}&os=windows&action=install`, name: 'hcm-worker.bat' },
            uninstall: { url: `${BASE}/worker-starter?city=${CITY}&os=windows&action=uninstall`, name: 'hcm-worker-remove.bat' },
        });
    });

    it('happyPath_onceShownItAsksTheServerOnceWhetherItMakesTheFile', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        expect(local.state.starter).toBeNull();

        local.start();
        local.start();
        await settle();

        expect(local.state.starter).toBe(true);
        expect(net.sent).toEqual([
            {
                url: `${BASE}/worker-starter?city=${CITY}&os=linux&action=install`,
                init: { method: 'HEAD', credentials: 'omit', cache: 'no-store' },
            },
        ]);
        local.intents.setOs('mac');
        expect(local.state.files.install).toEqual({
            url: `${BASE}/worker-starter?city=${CITY}&os=mac&action=install`,
            name: 'hcm-worker.command',
        });
    });

    it('badPath_aServerThatDoesNotMakeTheFileOrDoesNotAnswerSaysSo @S-A62-BAD-STARTER-TEMPLATE', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        net.starter = false;
        const local = localOf(world, net);
        local.start();
        await settle();
        expect(local.state.starter).toBe(false);

        const offline = new LocalComputer(world.services, {
            project: PROJECT,
            functionsBase: BASE,
            fetch: () => Promise.reject(new TypeError('offline')),
            userAgent: LINUX,
        });
        offline.start();
        await settle();
        expect(offline.state.starter).toBe(false);
    });
});

describe('Use this computer and the auto-pair', () => {
    it('happyPath_theFileIsGivenAndAWorkerThatTakesACodeIsPairedThenConnected @S-A62-HAPPY-AUTO-PAIR', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        local.start();
        await settle();
        expect(net.to('/state')).toEqual([]);

        local.intents.use();

        expect(world.services.local.get(LOCAL_KEY)).toBe(CITY);
        expect(local.state.phase).toBe('downloaded');
        await settle();
        // Nothing answers yet (the file is not run): the next look comes PROBE_MS later.
        net.state = answer();
        world.clock.advance(PROBE_MS);
        await settle();

        expect(local.state.phase).toBe('connecting');
        expect(world.callables.calls.find((call) => call.name === 'worker.pairCode')?.request).toEqual({ cityId: CITY });
        const posted = net.to('/pair');
        expect(posted).toHaveLength(1);
        expect(posted[0]?.init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' } });
        const body = posted[0]?.init?.body;
        expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({ code: CODE });

        net.state = answer({ signedIn: true, pairable: false });
        world.clock.advance(PROBE_MS);
        await settle();
        expect(local.state.phase).toBe('connected');
        expect(net.to('/pair')).toHaveLength(1);
        local.stop();
        world.clock.advance(PROBE_MS * 3);
        await settle();
        expect(net.to('/state')).toHaveLength(3);
    });

    it('happyPath_aComputerSetUpAnotherWayIsFoundAndPairedWithNoFile @S-A62-HAPPY-FIND-COMPUTER', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        local.start();
        await settle();
        expect(net.to('/state')).toEqual([]);
        net.state = answer();

        local.intents.find();

        expect(world.services.local.get(LOCAL_KEY)).toBe(CITY);
        expect(local.state.phase).toBe('looking');
        await settle();
        expect(local.state.phase).toBe('connecting');
        expect(net.to('/pair')).toHaveLength(1);
        local.stop();
    });

    it('badPath_nothingAnswersSoItKeepsLookingAndSaysSo @S-A62-BAD-FIND-COMPUTER', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        local.start();

        local.intents.find();
        await settle();
        world.clock.advance(PROBE_MS);
        await settle();

        expect(local.state.phase).toBe('looking');
        expect(net.to('/state').length).toBeGreaterThan(1);
        expect(net.to('/pair')).toEqual([]);
        local.stop();
    });

    it('happyPath_aReloadLooksAgainAndNeverSaysAFileWasJustSaved @S-A62-HAPPY-LOOKING-AFTER-RELOAD', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        localOf(world, net).intents.find();

        const reloaded = localOf(world, net);

        expect(reloaded.state.phase).toBe('looking');
        net.state = answer({ signedIn: true });
        reloaded.start();
        await settle();
        expect(reloaded.state.phase).toBe('connected');
        reloaded.stop();
    });

    it('badPath_aBrowserThatSetNothingUpStaysWithNothingAfterAReload', () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, 'another-city');

        expect(localOf(world, new FakeNet()).state.phase).toBe('none');
    });

    it('badPath_aWorkerOfAnotherCityOrOneThatTakesNoCodeIsNotPaired @S-A62-BAD-AUTO-PAIR', async () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, CITY);
        const net = new FakeNet();
        net.state = answer({ city: 'bacau' });
        const local = localOf(world, net);

        local.start();
        await settle();
        net.state = answer({ pairable: false, lastError: 'apiError.worker.revoked' });
        world.clock.advance(PROBE_MS);
        await settle();
        net.state = { not: 'a state' };
        world.clock.advance(PROBE_MS);
        await settle();

        expect(world.callables.named('worker.pairCode')).toBe(0);
        expect(net.to('/pair')).toEqual([]);
        expect(local.state.phase).toBe('looking');
        local.stop();
    });

    it('badPath_aCodeIsPostedAgainOnlyAMinuteLaterAndARefusedCodeIsLogged', async () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, CITY);
        const net = new FakeNet();
        net.state = answer();
        const local = localOf(world, net);
        world.callables.fail('worker.pairCode', failure('permission-denied', 'apiError.notAdmin'));

        local.start();
        await settle();
        world.clock.advance(PROBE_MS);
        await settle();

        expect(world.callables.named('worker.pairCode')).toBe(1);
        expect(net.to('/pair')).toEqual([]);
        expect(local.state.phase).toBe('connecting');
        world.callables.answer('worker.pairCode', () => ({ code: CODE, expiresAt: '2025-10-09T08:10:00.000Z' }));
        world.clock.advance(60_000);
        await settle();
        expect(net.to('/pair')).toHaveLength(1);
        local.stop();
    });
});

describe('Stop using this computer and the Advanced command', () => {
    it('happyPath_theRemovalFileIsGivenAndTheComputersWorkerDisconnected @S-A62-HAPPY-STOP-COMPUTER', async () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, CITY);
        const net = new FakeNet();
        net.state = answer({ signedIn: true, pairable: false });
        const local = localOf(world, net, WINDOWS);
        local.start();
        await settle();
        expect(local.state).toMatchObject({ os: 'windows', phase: 'connected' });

        await local.intents.stop();

        expect(local.state.files.uninstall.name).toBe('hcm-worker-remove.bat');
        expect(world.callables.calls.find((call) => call.name === 'worker.revoke')?.request).toEqual({
            cityId: CITY,
            workerId: 'w-0123456789abcdef',
        });
        expect(world.services.local.get(LOCAL_KEY)).toBeNull();
        expect(local.state.phase).toBe('stopped');
        world.clock.advance(PROBE_MS * 2);
        await settle();
        expect(net.to('/state')).toHaveLength(1);
    });

    it('badPath_noWorkerAnsweredSoNothingIsDisconnectedAndTheMacFileIsACommand', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');

        await local.intents.stop();

        expect(local.state.files.uninstall.name).toBe('hcm-worker-remove.command');
        expect(world.callables.named('worker.revoke')).toBe(0);
    });

    it('happyPath_advancedMintsItsCodeAndRenewsItWhileShown @S-A62-HAPPY-PAIR', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        local.start();

        await local.intents.command();
        expect(local.state.code).toBe(CODE);
        world.clock.advance(9 * 60_000);
        await settle();
        expect(world.callables.named('worker.pairCode')).toBe(2);

        local.stop();
        world.clock.advance(9 * 60_000);
        await settle();
        expect(world.callables.named('worker.pairCode')).toBe(2);
        world.callables.fail('worker.pairCode', failure('permission-denied', 'apiError.notAdmin'));
        await local.intents.command();
        expect(local.state.code).toBeNull();
    });

    it('happyPath_thePagesFetchAndSystemAreTheDefaults', () => {
        const local = createLocal(contentWorld().services, PROJECT);
        local.intents.setOs('mac');

        expect(local.state.os).toBe('mac');
    });
});
