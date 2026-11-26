import { describe, expect, it } from 'vitest';

import { workerMachineSchema, workerProfileRequestSchema, type WorkerMachine } from '../../src/api/index.js';

/** What the governor says on the laptop of 2026-11-12 (`pipeline/tests/unit/test_governor_loop.py`). */
const LAPTOP: WorkerMachine = {
    cpu: { cores: 16 },
    memory: { totalMb: 30_720, availableMb: 23_040, limitMb: 18_432 },
    power: { source: 'ac' },
    gpus: [{ vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3080 Laptop GPU', vramMb: 8192, via: 'cuda' }],
    npus: [],
    backend: { matcher: 'cuda' },
    profile: { chosen: 'auto', active: 'full', why: 'idle' },
    budget: { threads: 14, memoryMb: 13_824, gpuFraction: 0.7 },
    usage: { cpuPct: 3.5, othersCpuPct: 12, memoryMb: 640, vramMb: 0, tempC: 61 },
};

describe('workerMachineSchema (M26)', () => {
    it('reads what the governor says, a card no runtime reaches and a battery included', () => {
        expect(workerMachineSchema.parse(LAPTOP)).toEqual(LAPTOP);
        const nuc = {
            ...LAPTOP,
            power: { source: 'battery', percent: 20 },
            gpus: [{ vendor: 'intel', name: 'Arc 140T', vramMb: 0, via: null, why: 'no-image' }],
            npus: [{ vendor: 'intel', name: 'Core Ultra NPU', via: 'openvino' }],
            backend: { matcher: 'cpu', why: 'no-image' },
            profile: { chosen: 'auto', active: 'paused', why: 'battery' },
        };
        expect(workerMachineSchema.safeParse(nuc).success).toBe(true);
    });

    it('refuses what no governor says', () => {
        const bad = [
            { ...LAPTOP, cpu: { cores: 0 } },
            { ...LAPTOP, backend: { matcher: 'directml' } },
            { ...LAPTOP, profile: { chosen: 'turbo', active: 'full', why: 'idle' } },
            { ...LAPTOP, budget: { threads: 1, memoryMb: 1, gpuFraction: 1.5 } },
            { ...LAPTOP, usage: { ...LAPTOP.usage, cpuPct: 140 } },
        ];
        expect(bad.map((each) => workerMachineSchema.safeParse(each).success)).toEqual([false, false, false, false, false]);
    });

    it('takes a profile and nothing else in POST /profile', () => {
        expect(workerProfileRequestSchema.parse({ profile: 'quiet', batteryAllowed: true })).toEqual({
            profile: 'quiet',
            batteryAllowed: true,
        });
        expect(workerProfileRequestSchema.safeParse({ profile: 'quiet', extra: 1 }).success).toBe(false);
    });
});
