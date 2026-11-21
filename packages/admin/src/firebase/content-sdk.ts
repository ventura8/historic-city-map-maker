/**
 * The Firestore functions the editors' `ContentStore` adapter uses (`content.ts`), in one table the adapter takes, so its
 * node tests pass a fake table (the pattern of `sdk.ts`). Only this folder and the entry import the Firebase JS SDK
 * (dependency-cruiser `admin-firebase-sdk-only-in-adapters`).
 */
import {
    collection,
    collectionGroup,
    deleteField,
    doc,
    getCountFromServer,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    where,
    writeBatch,
} from 'firebase/firestore';

export const contentSdk = {
    collection,
    collectionGroup,
    deleteField,
    doc,
    getCountFromServer,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    where,
    writeBatch,
};

export type ContentSdk = typeof contentSdk;
