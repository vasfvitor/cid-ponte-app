/** IndexedDB key-value store for the downloaded WHO files and the license-acceptance flag. */

import { clear, createStore, get as idbGet, keys, set } from "idb-keyval";

// Do not rename: downloaded files and the license flag already live in this database/store.
const files = createStore("cid-ponte-app", "files");

export const get = <T>(key: string): Promise<T | undefined> => idbGet<T>(key, files);

/** By key listing, not `get`: a cached zip is several MB and only its presence matters. */
export const has = async (key: string): Promise<boolean> => (await keys(files)).includes(key);

export const put = (key: string, value: unknown): Promise<void> => set(key, value, files);

export const clearAll = (): Promise<void> => clear(files);
