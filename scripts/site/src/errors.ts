import { translate, type ValidationIssue } from '@hcm/shared';

/** A problem with the site's inputs (a file, the configuration, the manifest): the build stops with exit status 1. */
export class SiteBuildError extends Error {
    override readonly name = 'SiteBuildError';
}

/** `city.mapbox.publicToken: The value is not allowed. (validation.format)`, one issue per line, at most `limit`. */
export function issuesText(issues: readonly ValidationIssue[], limit = 10): string {
    const lines = issues.slice(0, limit).map((issue) => `${issue.path || '(root)'}: ${translate('en', issue.code)} (${issue.code})`);
    const more = issues.length > limit ? [`... and ${String(issues.length - limit)} more`] : [];
    return [...lines, ...more].join('\n');
}
