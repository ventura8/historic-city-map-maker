// A fake of the city's computers (`HouseholdPort`, W5): its state set by the test, its intents recorded.
import type { WorkerOsPort } from '../../../src/admin/worker/worker-port.js';
import type { AddKindPort, ComputerViewPort, HouseholdPort, HouseholdViewPort } from '../../../src/admin/worker/worker-port.js';

/** One computer as the list reads it: online, idle, its helper current. */
export function computer(changes: Partial<ComputerViewPort> = {}): ComputerViewPort {
    return {
        id: 'w-0123456789abcdef',
        name: 'nuc',
        online: true,
        state: 'idle',
        jobId: null,
        paused: false,
        share: { profile: 'full', why: 'idle', cores: 8, threads: 7, memoryMb: 8192 },
        os: 'linux',
        starter: '0123456789ab',
        starterCurrent: true,
        version: '1.0.0',
        outdated: false,
        seenAt: '2026-11-13T09:00:00.000Z',
        removal: null,
        revoked: false,
        disk: { workBytes: 13_207_024_435, freeBytes: 44_023_414_784, floorBytes: 10_737_418_240 },
        freeing: false,
        freed: null,
        sharing: null,
        ...changes,
    };
}

export class FakeHousehold implements HouseholdPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: HouseholdViewPort) => void>();
    /** What the next action answers. */
    answer = true;
    state: HouseholdViewPort = {
        status: 'ready',
        failure: null,
        computers: [computer()],
        adding: null,
        code: null,
        expiresAt: null,
        codeFailed: false,
        line: null,
        link: 'https://demo-hcm.web.app/admin/#/jobs',
        acting: null,
        refusal: null,
    };

    readonly intents = {
        add: (kind: AddKindPort | null): void => {
            this.calls.push(`add ${String(kind)}`);
            this.set({ adding: kind });
        },
        mint: (): Promise<void> => {
            this.calls.push('mint');
            return Promise.resolve();
        },
        rename: (id: string, name: string): Promise<boolean> => this.#record(`rename ${id} ${name}`),
        pause: (id: string): Promise<boolean> => this.#record(`pause ${id}`),
        resume: (id: string): Promise<boolean> => this.#record(`resume ${id}`),
        freeSpace: (id: string): Promise<boolean> => this.#record(`freeSpace ${id}`),
        remove: (id: string, options: { readonly docker: boolean; readonly keep: boolean }): Promise<boolean> =>
            this.#record(`remove ${id} docker=${String(options.docker)} keep=${String(options.keep)}`),
        disconnect: (id: string): Promise<boolean> => this.#record(`disconnect ${id}`),
        retry: (): void => {
            this.calls.push('retry');
        },
    };

    cleanup(os: WorkerOsPort): string {
        return `curl -fsSL 'https://us-central1-demo-hcm.cloudfunctions.net/worker-starter?city=bucharest&os=${os}&action=uninstall' -o ~/x && sh ~/x`;
    }

    subscribe(listener: (state: HouseholdViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    start(): void {
        this.calls.push('start');
    }

    stop(): void {
        this.calls.push('stop');
    }

    set(changes: Partial<HouseholdViewPort>): void {
        this.state = { ...this.state, ...changes };
        for (const listener of this.#listeners) {
            listener(this.state);
        }
    }

    #record(call: string): Promise<boolean> {
        this.calls.push(call);
        return Promise.resolve(this.answer);
    }
}
