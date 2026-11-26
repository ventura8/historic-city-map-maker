import process from 'node:process';

import type { FullConfig, Reporter, Suite, TestRun } from '@playwright/test/reporter';

import { excludedPositions, shardRangeFrom } from './split.js';

/**
 * The shard of a split run whose admin tier is divided by `E2E_ADMIN_PART` (docs/research/DECISIONS-for-review.md §32f).
 * Playwright's own shard counts every test of the queue, so each machine's admin projects would move the other tiers'
 * boundaries and sit in whichever slice holds the queue's head. `e2e/playwright.config.ts` registers this reporter only
 * when both `E2E_SHARD` and `E2E_ADMIN_PART` are set: it turns the built-in shard off and leaves out, of the tests outside
 * the admin tier and the dependency projects, those outside `E2E_SHARD` (e2e/split.ts). Both machines see the same queue
 * of those tests, so their slices meet exactly; each runs every admin test of its part.
 */
export default class SplitReporter implements Reporter {
    preprocess({ config, suite, testRun }: { config: FullConfig; suite: Suite; testRun: TestRun }): Promise<void> {
        const range = shardRangeFrom(process.env['E2E_SHARD']);
        if (range === null) {
            return Promise.resolve();
        }
        testRun.skipSharding();
        const dependencies = new Set(config.projects.flatMap((project) => project.dependencies));
        const tests = suite.allTests();
        const queued = tests.map((test) => {
            const project = test.parent.project();
            return { dependency: dependencies.has(project?.name ?? ''), tier: String(project?.metadata['tier'] ?? '') };
        });
        for (const position of excludedPositions(queued, range)) {
            const test = tests[position];
            if (test !== undefined) {
                testRun.exclude(test);
            }
        }
        return Promise.resolve();
    }

    printsToStdio(): boolean {
        return false;
    }
}
