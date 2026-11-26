import { START_PROJECT_TOKEN, hostingServingConfigSchema, type HostingServingConfig } from '@hcm/shared';

import { SiteBuildError } from '../errors.js';

/**
 * `firebase.json`'s `hosting` block as the Hosting REST API's `ServingConfig` (`sites.versions`,
 * `docs/research/M14-start-your-map.md` §6): `source` is `glob`, `destination` `path` or `location`, `type` `statusCode`,
 * `trailingSlash` `trailingSlashBehavior`, and a rule's headers an object. The repository's project id becomes the token.
 */
interface HostingRule {
    readonly source?: string;
    readonly regex?: string;
    readonly destination?: string;
    readonly type?: number;
    readonly headers?: readonly { readonly key: string; readonly value: string }[];
}

interface HostingBlock {
    readonly cleanUrls?: boolean;
    readonly trailingSlash?: boolean;
    readonly redirects?: readonly HostingRule[];
    readonly rewrites?: readonly HostingRule[];
    readonly headers?: readonly HostingRule[];
}

function matcher(rule: HostingRule): { glob?: string; regex?: string } {
    return rule.regex === undefined ? { glob: rule.source ?? '' } : { regex: rule.regex };
}

function trailing(value: boolean | undefined): { trailingSlashBehavior?: 'ADD' | 'REMOVE' } {
    return value === undefined ? {} : { trailingSlashBehavior: value ? 'ADD' : 'REMOVE' };
}

function rulesOf(rules: readonly HostingRule[] | undefined): readonly HostingRule[] {
    return rules ?? [];
}

function headersOf(rule: HostingRule): Readonly<Record<string, string>> {
    return Object.fromEntries((rule.headers ?? []).map((header) => [header.key, header.value]));
}

function redirectOf(rule: HostingRule): object {
    return { ...matcher(rule), location: rule.destination ?? '', statusCode: rule.type ?? 301 };
}

function cleanUrls(value: boolean | undefined): { cleanUrls?: boolean } {
    return value === undefined ? {} : { cleanUrls: value };
}

/** The serving rules, tokenised. */
export function servingConfigOf(hosting: unknown, projectId: string): HostingServingConfig {
    const block = (hosting ?? {}) as HostingBlock;
    const config = {
        rewrites: rulesOf(block.rewrites).map((rule) => ({ ...matcher(rule), path: rule.destination ?? '' })),
        redirects: rulesOf(block.redirects).map(redirectOf),
        headers: rulesOf(block.headers).map((rule) => ({ ...matcher(rule), headers: headersOf(rule) })),
        ...cleanUrls(block.cleanUrls),
        ...trailing(block.trailingSlash),
    };
    const parsed = hostingServingConfigSchema.safeParse(JSON.parse(JSON.stringify(config).replaceAll(projectId, START_PROJECT_TOKEN)));
    if (!parsed.success) {
        throw new SiteBuildError(`firebase.json's hosting block is not a ServingConfig: ${parsed.error.message}`);
    }
    return parsed.data;
}
