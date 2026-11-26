/**
 * The release's files as Hosting wants them (`docs/research/M14-start-your-map.md` §6): each fetched from the start site
 * itself, refused unless its SHA-256 is the manifest's, the project's id put into a template, then gzipped, and named by
 * the SHA-256 of the gzip ("Gzipping the files then taking the SHA256 hash": Hosting's REST deploy guide).
 */
import {
    START_PROJECT_TOKEN,
    START_RELEASE_FILE,
    START_TREE_FOLDER,
    startReleaseSchema,
    type StartFile,
    type StartRelease,
} from '@hcm/shared';

/** What the page uses of the browser; tests give fakes. */
export interface FileTools {
    readonly fetch: typeof fetch;
    readonly digest: (bytes: Uint8Array) => Promise<string>;
    readonly gzip: (bytes: Uint8Array) => Promise<Uint8Array>;
}

export interface PreparedFile {
    /** With a leading slash, as `populateFiles` takes it. */
    readonly path: string;
    readonly hash: string;
    readonly gzipped: Uint8Array;
}

/** Why the release cannot be used; the page names `path` and says to reload. */
export class StartFileError extends Error {
    override readonly name = 'StartFileError';
    readonly path: string;

    constructor(path: string) {
        super(`the release's file ${path} is not the expected one`);
        this.path = path;
    }
}

/** Why the manifest cannot be read. */
export class StartReleaseError extends Error {
    override readonly name = 'StartReleaseError';
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** SHA-256 as lower-case hex, through the browser's `crypto.subtle`. */
export async function sha256Hex(subtle: Pick<SubtleCrypto, 'digest'>, bytes: Uint8Array): Promise<string> {
    const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Gzip through the browser's `CompressionStream`. */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function releaseFolder(baseUrl: string, slug: string): string {
    return new URL(`release/${slug}/`, baseUrl).toString();
}

export async function loadRelease(tools: Pick<FileTools, 'fetch'>, baseUrl: string, slug: string): Promise<StartRelease> {
    const response = await tools.fetch(`${releaseFolder(baseUrl, slug)}${START_RELEASE_FILE}`, { cache: 'no-cache' }).catch(() => null);
    const body = response?.ok === true ? ((await response.json().catch(() => null)) as unknown) : null;
    const parsed = startReleaseSchema.safeParse(body);
    if (!parsed.success) {
        throw new StartReleaseError('the release manifest is missing or invalid');
    }
    return parsed.data;
}

/** One file's bytes, checked against the manifest. */
async function checkedBytes(tools: FileTools, folder: string, file: StartFile): Promise<Uint8Array> {
    const response = await tools.fetch(`${folder}${START_TREE_FOLDER}/${file.path}`).catch(() => null);
    if (response?.ok !== true) {
        throw new StartFileError(file.path);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await tools.digest(bytes)) !== file.sha256) {
        throw new StartFileError(file.path);
    }
    return bytes;
}

/** A template with the project's id in it; any other file as it is. */
function adopted(bytes: Uint8Array, file: StartFile, projectId: string): Uint8Array {
    return file.template === true ? encoder.encode(decoder.decode(bytes).replaceAll(START_PROJECT_TOKEN, projectId)) : bytes;
}

/** What Hosting takes for `path`: the gzip and its hash. */
export async function preparedBytes(tools: FileTools, path: string, bytes: Uint8Array): Promise<PreparedFile> {
    const gzipped = await tools.gzip(bytes);
    return { path: `/${path}`, hash: await tools.digest(gzipped), gzipped };
}

/** Where the release's files are. */
export interface ReleaseSource {
    readonly baseUrl: string;
    readonly slug: string;
}

export async function prepareFile(tools: FileTools, source: ReleaseSource, file: StartFile, projectId: string): Promise<PreparedFile> {
    const bytes = await checkedBytes(tools, releaseFolder(source.baseUrl, source.slug), file);
    return preparedBytes(tools, file.path, adopted(bytes, file, projectId));
}

/** The serving rules with the project's id in them. */
export function adoptedConfig<Config>(config: Config, projectId: string): Config {
    return JSON.parse(JSON.stringify(config).replaceAll(START_PROJECT_TOKEN, projectId)) as Config;
}
