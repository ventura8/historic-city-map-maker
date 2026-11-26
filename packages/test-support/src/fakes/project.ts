import { FIXTURE_VALUES } from '../api-fixtures/index.js';

/**
 * The e2e world's `infra/project.json` (`docs/research/M2b-interfaces.md` §3.7): the admin's e2e build and the
 * provisioner's tests use it instead of the real project's file. The GitHub ids are generated test values.
 */
export const E2E_PROJECT_CONFIG = {
    projectId: String(FIXTURE_VALUES['projectId']),
    projectNumber: String(FIXTURE_VALUES['projectNumber']),
    region: String(FIXTURE_VALUES['region']),
    cities: ['bucharest'],
    viewerOrigins: ['https://ventura8.github.io'],
    github: { owner: 'e2e-owner', ownerId: 1000001, repo: 'e2e-site', repoId: 2000002, branch: 'master', environment: 'deploy' },
} as const;
