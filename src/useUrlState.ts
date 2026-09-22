import { useCallback, useEffect, useState } from "react";
import { parsePublicationPeriod, type PublicationPeriod } from "./publicationDate";

// 把檢索狀態綁到 URL query string。
//
// 原本分類軸、搜尋字串、免費篩選全部只活在 React state，造成三件事做不到：
// 分享一個檢索結果、把它加書籤、按瀏覽器上一頁回到前一次檢索。對「主治跟住院醫師說
// 你看膝的 ACL 那組」這種實際情境，截圖是唯一辦法。
//
// 用 replaceState 寫入（不汙染上一頁歷史），只有使用者真的換過條件才 pushState。

export interface ViewState {
  q: string;
  axis: string;
  free: boolean;
  year: string;
  period: PublicationPeriod;
  type: string;
  sort: "relevance" | "latest";
}

const DEFAULTS: ViewState = { q: "", axis: "region", free: false, year: "", period: "", type: "", sort: "relevance" };

function parse(search: string): ViewState {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q") ?? DEFAULTS.q,
    axis: params.get("axis") ?? DEFAULTS.axis,
    free: params.get("free") === "1",
    year: params.get("year") ?? "",
    period: parsePublicationPeriod(params.get("period")),
    type: params.get("type") ?? "",
    sort: params.get("sort") === "latest" ? "latest" : "relevance",
  };
}

function serialize(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.axis !== DEFAULTS.axis) params.set("axis", state.axis);
  if (state.free) params.set("free", "1");
  if (state.year) params.set("year", state.year);
  if (state.period) params.set("period", state.period);
  if (state.type) params.set("type", state.type);
  if (state.sort === "latest") params.set("sort", state.sort);
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

export function useUrlState(): [ViewState, (patch: Partial<ViewState>) => void] {
  const [state, setState] = useState<ViewState>(() =>
    typeof window === "undefined" ? DEFAULTS : parse(window.location.search),
  );

  // 上一頁／下一頁要能回到前一次檢索。
  useEffect(() => {
    const onPop = () => setState(parse(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const url = serialize(next);
      if (url !== window.location.search + window.location.pathname) {
        window.history.replaceState(null, "", url + window.location.hash);
      }
      return next;
    });
  }, []);

  return [state, update];
}
