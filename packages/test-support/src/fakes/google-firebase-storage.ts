import { fixtureResponse } from '../api-fixtures/index.js';
import { billingEnabled, type BillingState } from './google-billing.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { addBucket, type CloudStorageState } from './google-storage.js';
import { route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The Firebase Storage API's default bucket (`<project>.firebasestorage.app`) for the `buckets` doctor item
 * (`docs/research/M2b-interfaces.md` §3.4 item 4; the request shape is **UNVERIFIED**): a new one needs Blaze, and it is
 * a Cloud Storage bucket too, so the bucket API answers for it afterwards.
 */

const FIREBASE_STORAGE: GoogleApi = {
    service: 'firebasestorage.googleapis.com',
    title: 'Cloud Storage for Firebase API',
    permission: 'firebasestorage.defaultBucket.create',
};

/** The fake default-bucket API over the Cloud Storage fake's buckets. */
export function createFirebaseStorageFake(storage: CloudStorageState, billing: BillingState, projects: GoogleProjects): ServiceFake {
    const bucketOf = (projectId: string): string => `${projectId}.firebasestorage.app`;
    const answer = (projectId: string, number: string): Response =>
        fixtureResponse('firebase-storage/default-bucket.get', { values: { projectNumber: number, bucket: bucketOf(projectId) } });
    const get: Route['answer'] = (_request, params) => {
        const project = projects.resolve(String(params['project']));
        return storage.buckets.has(bucketOf(project.id))
            ? answer(project.id, project.number)
            : googleError('google/error.not-found', FIREBASE_STORAGE);
    };
    const create: Route['answer'] = (_request, params) => {
        const project = projects.resolve(String(params['project']));
        if (!billingEnabled(billing, project.id)) {
            return fixtureResponse('firebase-storage/default-bucket.billing-required', { values: { projectNumber: project.number } });
        }
        if (storage.buckets.has(bucketOf(project.id))) {
            return googleError('google/error.already-exists', FIREBASE_STORAGE);
        }
        addBucket(storage, bucketOf(project.id), project.number);
        return answer(project.id, project.number);
    };
    const base = 'https://firebasestorage.googleapis.com/v1alpha/projects/{project}/defaultBucket';
    return {
        name: 'firebase-storage',
        routes: [
            route('GET', base, 'firebase-storage.defaultBucket.get', authenticated(FIREBASE_STORAGE, get)),
            route('POST', base, 'firebase-storage.defaultBucket.create', authenticated(FIREBASE_STORAGE, create)),
        ],
        failure: (mode) => googleFailure(FIREBASE_STORAGE, mode),
        scenarios: {},
        snapshot: () => ({}),
    };
}
