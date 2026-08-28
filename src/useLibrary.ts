import { useCallback, useEffect, useState } from "react";

// 收藏與最近瀏覽，存在瀏覽器本機。
//
// 這是靜態站，沒有後端也沒有帳號——localStorage 是誠實的邊界：
// 資料只留在這台裝置、不會同步、清除瀏覽資料就沒了，所以 UI 要說清楚。
// 每個存取都包 try/catch：無痕視窗、封鎖網站資料的瀏覽器會直接丟例外。

const STAR_KEY = "review.stars";
const RECENT_KEY = "review.recent";
const RECENT_MAX = 20;

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 容量已滿或被封鎖時靜默略過——這是加值功能，不該讓頁面壞掉 */
  }
}

export function useLibrary() {
  const [stars, setStars] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  // 首次 render 後才讀，避免 SSR／預渲染時碰 localStorage
  useEffect(() => {
    setStars(read(STAR_KEY));
    setRecent(read(RECENT_KEY));
  }, []);

  // 同一個站開多個分頁時保持一致
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STAR_KEY) setStars(read(STAR_KEY));
      if (e.key === RECENT_KEY) setRecent(read(RECENT_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleStar = useCallback((key: string) => {
    setStars((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [key, ...prev];
      write(STAR_KEY, next);
      return next;
    });
  }, []);

  const markRead = useCallback((key: string) => {
    setRecent((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, RECENT_MAX);
      write(RECENT_KEY, next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    write(RECENT_KEY, []);
  }, []);

  return { stars, recent, toggleStar, markRead, clearRecent };
}
