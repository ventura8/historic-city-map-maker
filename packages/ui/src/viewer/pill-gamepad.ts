import { connectedPads } from './gamepad/pads.js';

const BUTTONS = new Map([
    [0, 'Enter'],
    [12, 'ArrowUp'],
    [13, 'ArrowDown'],
    [14, 'ArrowLeft'],
    [15, 'ArrowRight'],
]);

function stickKey(pad: Gamepad): string | undefined {
    const [x = 0, y = 0] = pad.axes;
    if (Math.max(Math.abs(x), Math.abs(y)) < 0.55) {
        return undefined;
    }
    return directionKey(x, y);
}

function directionKey(x: number, y: number): string {
    if (Math.abs(x) > Math.abs(y)) {
        return x < 0 ? 'ArrowLeft' : 'ArrowRight';
    }
    return y < 0 ? 'ArrowUp' : 'ArrowDown';
}

function padKey(pad: Gamepad): string | undefined {
    const emulation = navigator as Partial<Record<'gamepadInputEmulation', string>>;
    if (emulation.gamepadInputEmulation !== 'keyboard') {
        for (const [button, key] of BUTTONS) {
            if (pad.buttons[button]?.pressed) {
                return key;
            }
        }
    }
    return stickKey(pad);
}

export class PillGamepad {
    #frame = 0;
    #last: string | undefined;
    #next = 0;

    constructor(private readonly press: (key: string) => void) {}

    start(): void {
        this.stop();
        this.#frame = requestAnimationFrame(this.#tick);
    }

    stop(): void {
        cancelAnimationFrame(this.#frame);
        this.#last = undefined;
    }

    readonly #tick = (now: number): void => {
        this.#frame = requestAnimationFrame(this.#tick);
        const pad = connectedPads(window).find((candidate) => candidate.mapping === 'standard');
        const key = pad && padKey(pad);
        if (key && this.#ready(key, now)) {
            this.#next = now + (key === this.#last ? 150 : 400);
            this.press(key);
        }
        this.#last = key;
    };

    #ready(key: string, now: number): boolean {
        return key !== this.#last || (key !== 'Enter' && now >= this.#next);
    }
}
