/**
 * The Firebase JS SDK functions the admin uses (`firebase` 13.0.0, the engine's pin), in one table the adapters take, so
 * their node tests pass a fake table instead. Analytics is not here: it is its own lazily imported module
 * (`analytics-sdk.ts`), loaded only after consent. Only this folder and the entry import the SDK
 * (`docs/research/M2b-interfaces.md` §1.7).
 */
import { initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check';
import {
    GoogleAuthProvider,
    browserLocalPersistence,
    browserPopupRedirectResolver,
    browserSessionPersistence,
    connectAuthEmulator,
    indexedDBLocalPersistence,
    initializeAuth,
    onAuthStateChanged,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    signInWithCredential,
    signInWithPopup,
    signOut,
} from 'firebase/auth';
import {
    collection,
    connectFirestoreEmulator,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage, ref, uploadBytes } from 'firebase/storage';

/**
 * The emulators' connectors, for the `e2e` build and the tests. The production build never connects to an emulator, so it
 * carries none: `import.meta.env.MODE` is a constant there, and the bundler drops the SDKs' connectors and their emulator
 * banners (about 0.85 KB gzip of the admin's total, DECISIONS-for-review.md §81e).
 */
const EMULATOR_CONNECTORS = { connectAuthEmulator, connectFunctionsEmulator, connectFirestoreEmulator, connectStorageEmulator };

function noEmulator(): never {
    throw new Error('the production build connects to no emulator');
}

const EMULATORS: typeof EMULATOR_CONNECTORS =
    import.meta.env.MODE === 'production'
        ? {
              connectAuthEmulator: noEmulator,
              connectFunctionsEmulator: noEmulator,
              connectFirestoreEmulator: noEmulator,
              connectStorageEmulator: noEmulator,
          }
        : EMULATOR_CONNECTORS;

export const firebaseSdk = {
    initializeApp,
    initializeAppCheck,
    ReCaptchaEnterpriseProvider,
    initializeAuth,
    browserSessionPersistence,
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserPopupRedirectResolver,
    onAuthStateChanged,
    signOut,
    signInWithPopup,
    reauthenticateWithPopup,
    signInWithCredential,
    reauthenticateWithCredential,
    GoogleAuthProvider,
    getFunctions,
    httpsCallable,
    getFirestore,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    onSnapshot,
    collection,
    query,
    where,
    getDocs,
    serverTimestamp,
    getStorage,
    ref,
    uploadBytes,
    ...EMULATORS,
};

export type FirebaseSdk = typeof firebaseSdk;
