/** OAuth 2.0 access tokens for Google REST APIs (the runtime service account's, via ADC). */
export interface TokenProvider {
    accessToken(): Promise<string>;
}
