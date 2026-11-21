import { redactText } from '@hcm/shared';

import { at, records, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Cloud Logging v2 `entries:list` for the installer's log summary (`docs/research/M6-interfaces.md` §1.7): a build
 * that runs as a user-specified account logs to Cloud Logging only (`CLOUD_LOGGING_ONLY`), one entry per line, labelled
 * with its step (`build_step`: `Step #3 - "functions"`). The admin reads a step's last lines; each is cut to
 * {@link MAX_LINE_LENGTH} characters and redacted (`redactText`: no `ya29.`, `sk.`, `pk.` or bearer value), and the
 * page shows it as text only.
 */

const LOGGING = 'https://logging.googleapis.com/v2/entries:list';

/** A build id as Cloud Build makes them (a UUID): checked before it enters the filter. */
const BUILD_ID = /^[0-9a-f-]{8,64}$/;

/** How many entries one read looks at, newest first (a step's tail is among them). */
const ENTRIES_READ = 500;

/** The longest line the card shows. */
export const MAX_LINE_LENGTH = 200;

/** How many lines of a step the card shows. */
const LOG_TAIL_LINES = 20;

export interface BuildLogLine {
    /** The step id the line's label names, or '' when it names none. */
    readonly step: string;
    readonly text: string;
    /** When the line was written (ISO 8601), or '' when Google gave no time. */
    readonly time: string;
}

export interface LoggingClient {
    /** The build's lines, oldest first (the newest {@link ENTRIES_READ} entries). */
    buildLines(projectId: string, buildId: string): Promise<readonly BuildLogLine[]>;
}

/** `Step #3 - "functions"` → `functions`; anything else → ''. */
export function stepOfLabel(label: string | undefined): string {
    return /"([\w.-]{1,64})"/.exec(label ?? '')?.[1] ?? '';
}

/** A line as the card may show it: one line, at most {@link MAX_LINE_LENGTH} characters, redacted. */
export function safeLogLine(text: string): string {
    const line = redactText(text.replaceAll(/[\r\n\t]+/g, ' ').trim());
    return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH - 1)}…` : line;
}

/** The last `count` lines of `step` (all steps' when `step` is null), oldest first. */
export function stepTail(lines: readonly BuildLogLine[], step: string | null, count: number = LOG_TAIL_LINES): readonly string[] {
    return lines
        .filter((line) => step === null || line.step === step)
        .slice(-count)
        .map((line) => line.text);
}

export function createLoggingClient(transport: GoogleTransport): LoggingClient {
    return {
        buildLines: async (projectId, buildId) => {
            if (!BUILD_ID.test(buildId)) {
                throw new RangeError(`not a build id: ${JSON.stringify(buildId)}`);
            }
            const body = await transport.call({
                operation: 'logging.entries.list',
                method: 'POST',
                url: LOGGING,
                body: {
                    resourceNames: [`projects/${projectId}`],
                    filter: `resource.type="build" AND resource.labels.build_id="${buildId}"`,
                    orderBy: 'timestamp desc',
                    pageSize: ENTRIES_READ,
                },
            });
            return records(at(body, 'entries'))
                .map((entry) => ({
                    step: stepOfLabel(stringAt(entry, 'labels', 'build_step')),
                    text: safeLogLine(stringAt(entry, 'textPayload') ?? ''),
                    time: stringAt(entry, 'timestamp') ?? '',
                }))
                .filter((line) => line.text !== '')
                .reverse();
        },
    };
}
