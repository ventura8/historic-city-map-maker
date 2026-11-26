/**
 * The M4 ports over the shared fake upstreams (`docs/research/M4-interfaces.md` §8): the real Nominatim, Vertex AI and
 * FCM adapters, each given the recording `fetch` of one `createUpstreamFakes()` world, so a handler test drives the same
 * HTTP shapes the e2e mock APIs answer and reads what was sent (`fakes.callsTo('nominatim.reverse')`,
 * `fakes.state.vertexAi.requests`, `fakes.state.fcm.messages`). Every value is a generated test value.
 */
import { createUpstreamFakes, type UpstreamFakes } from '@hcm/test-support/fakes';

import { createFcm } from '../../src/adapters/fcm.js';
import { createNominatim } from '../../src/adapters/nominatim.js';
import { createVertexAi } from '../../src/adapters/vertex-ai.js';
import type { Geocoder } from '../../src/ports/geocoder.js';
import type { PushSender } from '../../src/ports/push-sender.js';
import type { TokenProvider } from '../../src/ports/token-provider.js';
import type { Translator } from '../../src/ports/translator.js';

/** The functions' service account as the fakes see it: any bearer token is accepted. */
export const SERVICE_TOKENS: TokenProvider = { accessToken: () => Promise.resolve('test-service-account-token') };

export const PROJECT_ID = 'demo-hcm';

export interface M4Upstreams {
    readonly fakes: UpstreamFakes;
    readonly geocoder: Geocoder;
    readonly translator: Translator;
    readonly push: PushSender;
}

/** A fresh world of fake upstreams and the three M4 adapters over it. */
export function m4Upstreams(): M4Upstreams {
    const fakes = createUpstreamFakes();
    const google = { projectId: PROJECT_ID, tokens: SERVICE_TOKENS, fetch: fakes.fetch };
    return {
        fakes,
        geocoder: createNominatim({ fetch: fakes.fetch }),
        translator: createVertexAi(google),
        push: createFcm(google),
    };
}

/** A registration token as a browser's `getToken` returns one (a generated test value). */
export function fcmToken(name: string): string {
    return `e2e-fcm-token:${name}-${'x'.repeat(24)}`;
}
