import { createHash } from 'node:crypto';

/**
 * Subresource Integrity for the cross-origin files a page loads (`.htmlvalidate.json` → `require-sri`): Mapbox GL JS
 * from api.mapbox.com. The digest is computed from the exact npm release the repository pins (`mapbox-gl@3.34.1`),
 * which Mapbox publishes from the same build as the CDN copy.
 */
export function subresourceIntegrity(content: Uint8Array): string {
    return `sha384-${createHash('sha384').update(content).digest('base64')}`;
}
