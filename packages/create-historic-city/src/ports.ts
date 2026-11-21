/**
 * Everything the CLI does outside its own logic, behind ports (`docs/research/M5-interfaces.md` §4.5), so every
 * command runs in the tests over fakes: the owner's own command-line tools (`Runner`), their browser (`Opener`), the
 * terminal (`Terminal`), the target folder and the package's own files (`Files`), time (`Clock`) and the environment
 * (`Env`). `node-ports.ts` holds the real ones. Nothing here fetches anything: the CLI never reaches a network itself.
 */

/** What a captured command printed (a `--json` listing, a version). */
export interface Captured {
    readonly code: number;
    readonly stdout: string;
}

/** The owner's own command-line tools (`firebase`, `gcloud`), found on `PATH`. */
export interface Runner {
    /**
     * Runs `command` with the terminal inherited, so the owner sees and answers its prompts and Google's pages (a
     * sign-in, terms) open from it; the CLI never sees what is typed. Resolves its exit status, or null when the
     * command is not installed.
     */
    interactive(command: string, args: readonly string[], cwd?: string): Promise<number | null>;
    /** Runs `command` and keeps what it prints (never a credential: listings and versions); null when not installed. */
    capture(command: string, args: readonly string[], cwd?: string): Promise<Captured | null>;
}

/** Opens a page in the owner's browser (`xdg-open`, `open` or `start`, by platform). */
export interface Opener {
    open(url: string): Promise<void>;
}

/** The terminal the CLI talks through. */
export interface Terminal {
    /** Prints one line. */
    say(line: string): void;
    /** Asks `question` and resolves the line typed, trimmed; null once the input has ended. */
    ask(question: string): Promise<string | null>;
}

/** The files of one target folder (paths relative to it, never `..`) and the files the package carries. */
export interface Files {
    /** The target folder's absolute path. */
    readonly root: string;
    exists(path: string): boolean;
    /** The names in the target folder (none when it does not exist). */
    entries(): readonly string[];
    read(path: string): string;
    /** Writes a file, creating its folders. */
    write(path: string, content: string): void;
    /** Whether the package carries `path` (`template/index.html`, `self-host/`); an absolute path is read as it is. */
    bundled(path: string): boolean;
    /** A file the package carries (or an absolute path). */
    readBundled(path: string): string;
    /** Copies a folder the package carries (or an absolute folder) into `to`, below the target folder. */
    copyFolder(from: string, to: string): void;
}

export interface Clock {
    sleep(ms: number): Promise<void>;
}

export interface Env {
    /** `process.platform`. */
    readonly platform: string;
    /** `LANG`, for the language when `--lang` does not say. */
    readonly lang: string | undefined;
    /** The folder the CLI runs in. */
    readonly cwd: string;
    /** The running Node release (`process.versions.node`). */
    readonly nodeVersion: string;
}

export interface Ports {
    readonly runner: Runner;
    readonly opener: Opener;
    readonly terminal: Terminal;
    /** The files of `dir` (absolute, or relative to `env.cwd`). */
    readonly files: (dir: string) => Files;
    readonly clock: Clock;
    readonly env: Env;
}
