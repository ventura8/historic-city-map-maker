/**
 * The install builds' step scripts as the bundle carries them (`docs/research/M6-interfaces.md` §1.4): `steps.mjs`, the
 * step modules (`steps/index.ts`) bundled by Vite (Rolldown, the monorepo's bundler) with `@hcm/shared` and zod inlined,
 * since a build step has no `node_modules` but `firebase-tools`'; and one small entry per step, `steps/<name>.mjs`, which
 * runs it with the real world. The bundle is made in memory (`write: false`).
 */
import { build, type Rolldown } from 'vite';

/** The steps a build runs by name (`node steps/<name>.mjs …`). */
export const STEP_NAMES = ['deploy-with-retry', 'verify-server', 'run-jobs', 'hosting-config', 'deploy-hosting'] as const;

/** The step modules' entry, relative to the repository. */
const STEPS_ENTRY = 'scripts/site/src/install/steps/index.ts';

/** `steps/<name>.mjs`: runs step `name` and exits with its status. */
export function stepEntry(name: (typeof STEP_NAMES)[number]): string {
    return `import process from 'node:process';\nimport { runStep } from './steps.mjs';\n\nprocess.exitCode = await runStep('${name}', process.argv.slice(2));\n`;
}

type BuildResult = Awaited<ReturnType<typeof build>>;

/** The code chunks of a build made with `write: false` (an SSR build of TypeScript emits no asset). */
export function outputChunks(result: BuildResult): readonly Rolldown.OutputChunk[] {
    const outputs = Array.isArray(result) ? result : [result];
    return outputs
        .flatMap((output) => ('output' in output ? output.output : []))
        .filter((chunk): chunk is Rolldown.OutputChunk => chunk.type === 'chunk');
}

/** The bundle's `steps/` files (path → bytes), built from `root` (the repository). */
export async function bundleSteps(root: string): Promise<ReadonlyMap<string, Uint8Array>> {
    const result = await build({
        configFile: false,
        root,
        logLevel: 'warn',
        build: {
            ssr: STEPS_ENTRY,
            write: false,
            target: 'node24',
            minify: false,
            sourcemap: false,
            rolldownOptions: { output: { format: 'es', entryFileNames: 'steps.mjs', chunkFileNames: 'steps-[name].mjs' } },
        },
        ssr: { target: 'node', noExternal: true },
    });
    const encoder = new TextEncoder();
    const files = new Map(outputChunks(result).map((chunk) => [`steps/${chunk.fileName}`, encoder.encode(chunk.code)]));
    STEP_NAMES.forEach((name) => files.set(`steps/${name}.mjs`, encoder.encode(stepEntry(name))));
    return files;
}
