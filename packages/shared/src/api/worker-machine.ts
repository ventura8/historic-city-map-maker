/**
 * M26: what the local worker says of the computer it runs on (`docs/research/M26-governor.md` §6), `machine` in its
 * `GET /state`, read by the admin's "This computer" card. The governor (pipeline `hcm_pipeline/governor`) fills it every
 * few seconds: the cores and memory, the power, the graphics cards and NPUs and what can reach them, where the matcher
 * runs, the profile in force and why, the budget it sets and what the worker and everyone else use now. It never leaves
 * the computer: the admin reads it from the loopback, and `POST /profile` keeps the owner's choice in the worker's volume.
 */
import { z } from 'zod';

/** The owner's choice in the card; `auto` lets the governor decide. */
export const WORKER_PROFILE_CHOICES = ['auto', 'quiet', 'full'] as const;
/**
 * Pause this computer (the owner's request of 2026-11-13): besides the three profiles the owner picks, `paused`, chosen with Pause
 * this computer (the admin or the computer's own page), never with the profile switch.
 */
export const WORKER_CHOSEN = [...WORKER_PROFILE_CHOICES, 'paused'] as const;
/** The profile in force. */
export const WORKER_PROFILES = ['full', 'quiet', 'paused'] as const;
/** Why the governor chose it. */
export const WORKER_PROFILE_WHYS = ['idle', 'user-active', 'others-busy', 'battery', 'thermal', 'gpu-busy', 'owner'] as const;
/** Where the matcher runs: a graphics card through CUDA, ROCm or OpenVINO, the NPU through OpenVINO, the processor, or nowhere. */
export const WORKER_MATCHERS = ['cuda', 'rocm', 'openvino-gpu', 'openvino-npu', 'cpu', 'off'] as const;
/** The runtimes that can reach a card or an NPU from the sidecar's container. */
export const WORKER_ACCELERATOR_VIAS = ['cuda', 'rocm', 'openvino'] as const;
export const WORKER_POWER_SOURCES = ['ac', 'battery', 'unknown'] as const;

const megabytes = z.number().int().min(0);
const percent = z.number().min(0).max(100);
const word = z.string().regex(/^[a-z0-9-]{1,40}$/);
const label = z.string().min(1).max(120);

const acceleratorFields = {
    vendor: label,
    name: label,
    via: z.enum(WORKER_ACCELERATOR_VIAS).nullable(),
    why: word.optional(),
};

export const workerMachineSchema = z.object({
    cpu: z.object({ cores: z.number().int().min(1) }),
    memory: z.object({ totalMb: megabytes, availableMb: megabytes, limitMb: megabytes.optional() }),
    power: z.object({ source: z.enum(WORKER_POWER_SOURCES), percent: percent.optional() }),
    gpus: z.array(z.object({ ...acceleratorFields, vramMb: megabytes })).max(16),
    npus: z.array(z.object(acceleratorFields)).max(16),
    backend: z.object({ matcher: z.enum(WORKER_MATCHERS), why: word.optional() }),
    profile: z.object({
        chosen: z.enum(WORKER_CHOSEN),
        active: z.enum(WORKER_PROFILES),
        why: z.enum(WORKER_PROFILE_WHYS),
        /** While `chosen` is `paused` for a while (For 1 hour, Until tomorrow): when the pause ends on its own. */
        until: z.iso.datetime().optional(),
    }),
    budget: z.object({ threads: z.number().int().min(0), memoryMb: megabytes, gpuFraction: z.number().min(0).max(1) }),
    usage: z.object({
        cpuPct: percent,
        othersCpuPct: percent,
        memoryMb: megabytes,
        gpuPct: percent.optional(),
        vramMb: megabytes.optional(),
        tempC: z.number().min(-50).max(150).optional(),
    }),
});
export type WorkerMachine = z.infer<typeof workerMachineSchema>;
export type WorkerProfileChoice = (typeof WORKER_PROFILE_CHOICES)[number];

/** `POST /profile`'s body (the admin's card; the same origin rules as `/pair`). */
export const workerProfileRequestSchema = z.strictObject({
    profile: z.enum(WORKER_PROFILE_CHOICES),
    batteryAllowed: z.boolean().optional(),
});
export type WorkerProfileRequest = z.infer<typeof workerProfileRequestSchema>;
