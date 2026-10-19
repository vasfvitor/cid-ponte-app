/** IndexedDB key-value store for the downloaded WHO files. */

import { clear, createStore, del, get as idbGet, keys as idbKeys, set } from "idb-keyval";

// Do not rename: downloaded files already live in this database/store.
const files = createStore("cid-ponte-app", "files");

export const get = <T>(key: string): Promise<T | undefined> => idbGet<T>(key, files);

export const put = (key: string, value: unknown): Promise<void> => set(key, value, files);

export const remove = (key: string): Promise<void> => del(key, files);

export const keys = (): Promise<string[]> => idbKeys<string>(files);

export const clearAll = (): Promise<void> => clear(files);
