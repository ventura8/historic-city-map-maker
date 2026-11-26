// A fake of this computer's part (`LocalPort`, finding 72; finding 73: the starter files as links): its state set by
// the test, its intents recorded.
import type { WorkerProfileChoice } from '@hcm/shared';

import type { LocalPort, LocalViewPort, WorkerOsPort } from '../../../src/admin/worker/worker-port.js';

const BASE = 'https://us-central1-demo-hcm.cloudfunctions.net/worker-starter';

/** The two links of `os`, as the admin's `starterLinks` makes them. */
export function linksOf(os: WorkerOsPort): LocalViewPort['files'] {
    const extension = { linux: 'sh', mac: 'command', windows: 'bat' }[os];
    return {
        install: { url: `${BASE}?city=bucharest&os=${os}&action=install`, name: `hcm-worker.${extension}` },
        uninstall: { url: `${BASE}?city=bucharest&os=${os}&action=uninstall`, name: `hcm-worker-remove.${extension}` },
    };
}

export class FakeLocal implements LocalPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: LocalViewPort) => void>();
    state: LocalViewPort = {
        os: 'linux',
        phase: 'none',
        code: null,
        starter: true,
        files: linksOf('linux'),
        machine: { kind: 'unknown' },
        versions: null,
    };

    readonly intents = {
        setOs: (os: WorkerOsPort): void => {
            this.calls.push(`setOs ${os}`);
            this.set({ os, files: linksOf(os) });
        },
        use: (): void => {
            this.calls.push('use');
        },
        find: (): void => {
            this.calls.push('find');
            this.set({ phase: 'looking' });
        },
        stop: (): Promise<void> => {
            this.calls.push('stopUsing');
            return Promise.resolve();
        },
        profile: (choice: WorkerProfileChoice): Promise<void> => {
            this.calls.push(`profile ${choice}`);
            return Promise.resolve();
        },
        command: (): Promise<void> => {
            this.calls.push('command');
            this.set({ code: 'abcdefghijklmnopqrstuvwxyz' });
            return Promise.resolve();
        },
    };

    subscribe(listener: (state: LocalViewPort) => void): () => void {
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

    set(changes: Partial<LocalViewPort>): void {
        this.state = { ...this.state, ...changes };
        for (const listener of this.#listeners) {
            listener(this.state);
        }
    }
}
