import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paperAliases } from "./identity";
import type { Item } from "./types";
import { LIBRARY_KEY, emptyLibrary, libraryReadStatus, loadLibrary, mergeLibrary, parseLibraryBackup, refreshLibrarySnapshots, saveLibrary, serializeLibraryBackup, updateLibraryEntry } from "./libraryStorage";
import type { LibraryData, LibraryStorage, ReadStatus, StorageResult } from "./libraryStorage";

const EMPTY_CATALOG: Item[] = [];
function browserStorage(): LibraryStorage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Browser-local library. markRead preserves its legacy meaning: record a visit, not reading completion. */
export function useLibrary(catalog: Item[] = EMPTY_CATALOG) {
  const [data, setData] = useState<LibraryData>(emptyLibrary);
  const [storage, setStorage] = useState<StorageResult>({ status: "loading", message: null });
  const dataRef = useRef(data);
  const catalogRef = useRef(catalog);
  const loaded = useRef(false);
  catalogRef.current = catalog;

  const commit = useCallback((next: LibraryData) => {
    dataRef.current = next;
    setData(next);
    setStorage(saveLibrary(browserStorage(), next));
  }, []);

  useEffect(() => {
    const restore = () => {
      const result = loadLibrary(browserStorage());
      const next = refreshLibrarySnapshots(result.data, catalogRef.current);
      dataRef.current = next;
      setData(next);
      loaded.current = true;
      // Do not silently replace unreadable storage with an empty library.
      setStorage(result.status === "saved" ? saveLibrary(browserStorage(), next) : result);
    };
    restore();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LIBRARY_KEY || event.key === "review.stars" || event.key === "review.recent") {
        const result = loadLibrary(browserStorage());
        if (result.status !== "saved") { setStorage(result); return; }
        // Storage events must not write again: that causes ping-pong across tabs.
        const next = refreshLibrarySnapshots(result.data, catalogRef.current);
        dataRef.current = next;
        setData(next);
        setStorage(result);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const next = refreshLibrarySnapshots(dataRef.current, catalog);
    if (next !== dataRef.current) commit(next);
  }, [catalog, commit]);

  const changeEntry = useCallback((key: string, aliases: string[], item: Item | undefined, change: "toggle-star" | "visit" | ReadStatus) => {
    try {
      commit(updateLibraryEntry(dataRef.current, key, aliases, item, change));
    } catch (error) {
      setStorage(previous => ({ ...previous, message: error instanceof Error ? error.message : "無法更新文獻庫，請先匯出備份。" }));
    }
  }, [commit]);
  const toggleStar = useCallback((key: string, aliases: string[] = [key], item?: Item) => {
    changeEntry(key, aliases, item, "toggle-star");
  }, [changeEntry]);
  const markRead = useCallback((key: string, item?: Item) => {
    changeEntry(key, item ? paperAliases(item) : [key], item, "visit");
  }, [changeEntry]);
  const setReadStatus = useCallback((key: string, status: ReadStatus, item?: Item) => {
    changeEntry(key, item ? paperAliases(item) : [key], item, status);
  }, [changeEntry]);
  const getReadStatus = useCallback((key: string, aliases: string[] = [key]): ReadStatus => {
    return libraryReadStatus(dataRef.current, key, aliases);
  }, []);
  const clearRecent = useCallback(() => {
    commit({ ...dataRef.current, recent: [], entries: dataRef.current.entries.filter(entry => entry.starred || entry.readStatus === "read") });
  }, [commit]);
  const exportBackup = useCallback(() => serializeLibraryBackup(dataRef.current), []);
  const importBackup = useCallback((raw: string): { ok: boolean; message: string } => {
    try {
      const imported = parseLibraryBackup(raw);
      const next = refreshLibrarySnapshots(mergeLibrary(dataRef.current, imported), catalogRef.current);
      commit(next);
      return { ok: true, message: `已合併備份中的 ${imported.entries.filter(entry => entry.starred).length} 篇收藏；相同文獻不會重複加入。` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "匯入失敗，原有文獻庫未變更。" };
    }
  }, [commit]);
  const stars = useMemo(() => data.entries.filter(entry => entry.starred).map(entry => entry.id), [data.entries]);
  return { stars, recent: data.recent, entries: data.entries, storageStatus: storage.status, storageMessage: storage.message,
    toggleStar, markRead, clearRecent, setReadStatus, getReadStatus, exportBackup, importBackup };
}
export type LibraryApi = ReturnType<typeof useLibrary>;
