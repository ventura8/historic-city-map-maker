/** The non-secret health record setup/status, as stored (the handler validates every field it returns). */
type SetupRecord = Readonly<Record<string, unknown>>;

export interface SetupRecords {
    readStatus(): Promise<SetupRecord | undefined>;
}
