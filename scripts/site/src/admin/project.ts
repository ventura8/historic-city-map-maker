import { z } from 'zod';

import { validate } from '@hcm/shared';

import { SiteBuildError, issuesText } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import type { AdminFile } from './legacy.js';

/**
 * The project file the admin reads at boot (`/project.json`, docs/research/M2b-interfaces.md §3.7, CR-M2b-26): the
 * committed, public `infra/project.json` copied next to `index.html`, so the Setup Assistant provisions the project the
 * page names and no other. The admin validates it fully (`parseProjectConfig`); the build refuses a file that does not
 * even name a project and its cities, so a broken file fails the build instead of switching the Setup Assistant off.
 * The e2e admin server answers the e2e world's project instead (`e2e/mock-apis/admin-server.ts`).
 */

/** The committed project file. */
export const DEFAULT_PROJECT_FILE = 'infra/project.json';

/** Where the page reads it, next to `index.html`. */
export const PROJECT_FILE = 'project.json';

const projectFileSchema = z.looseObject({
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
    cities: z.array(z.string().min(1)).min(1),
});

export interface ProjectFile {
    readonly file: AdminFile;
    readonly projectId: string;
}

/** The page's `project.json`, read and checked from `path`; throws SiteBuildError when it is missing or invalid. */
export function planProjectFile(files: SiteFileSystem, path = DEFAULT_PROJECT_FILE): ProjectFile {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: the admin's Setup Assistant needs the project it provisions`);
    }
    let input: unknown;
    try {
        input = JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: not JSON: ${String(error)}`);
    }
    const result = validate(projectFileSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${path}: invalid project file\n${issuesText(result.issues)}`);
    }
    return { file: { to: PROJECT_FILE, content: `${JSON.stringify(input)}\n` }, projectId: result.value.projectId };
}
