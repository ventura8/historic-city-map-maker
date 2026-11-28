export interface NaraDigitizedAerialSearchRequest {
    readonly query: string;
    readonly rows: number;
}

export interface NaraDigitizedAerialSearchCall {
    readonly callable: string;
    readonly payload: NaraDigitizedAerialSearchRequest;
    readonly auth: Readonly<Record<'x-api-key', string>>;
}

function requireNonEmpty(value: string, label: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new Error(`${label} is required.`);
    }
    return trimmed;
}

/**
 * The NARA search callable payload for digitized aerial items (Catalog API v2) and its key auth header.
 * The caller passes the key that Setup stored as `nara-catalog-api-v2-key`.
 */
export function naraDigitizedAerialSearchCall(storedKey: string, query: string, rows = NARA_DEFAULT_ROWS): NaraDigitizedAerialSearchCall {
    const key = requireNonEmpty(storedKey, 'NARA Catalog API v2 key');
    const trimmedQuery = requireNonEmpty(query, 'Search query');
    if (!Number.isInteger(rows) || rows <= 0) {
        throw new Error('Rows must be a positive integer.');
    }
    return {
        callable: NARA_SEARCH_CALLABLE,
        payload: { query: trimmedQuery, rows },
        auth: { 'x-api-key': key },
    };
}

export interface NaraSourceSchema {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly icon?: string;
    readonly setupCard: {
        apiKeyLabel: string;
        apiKeyPlaceholder: string;
        searchCallable: (storedKey: string, query: string, rows?: number) => NaraDigitizedAerialSearchCall;
    };
}

// Extend the existing 'nara' source card to include a field for storing a NARA Catalog API v2 key.
export const naraSourceSchema: NaraSourceSchema = {
    id: 'nara',
    name: 'NARA Catalog',
    description: 'Search digitized aerial items from the NARA Catalog API v2.',
    icon: 'https://example.com/nara-icon.png', // Replace with actual icon URL if available
    setupCard: {
        apiKeyLabel: 'NARA Catalog API v2 Key',
        apiKeyPlaceholder: 'Enter your NARA Catalog API v2 key here',
        searchCallable: naraDigitizedAerialSearchCall,
    },
};
