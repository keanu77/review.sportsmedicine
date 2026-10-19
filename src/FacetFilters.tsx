import { FACETS, FACET_LABELS, facetOptions, type FacetState, type FacetKey } from "./facets";
import type { Item } from "./types";

export default function FacetFilters({ items, value, onChange }: { items: Item[]; value: FacetState; onChange: (key: FacetKey, value: string) => void }) {
  return <fieldset className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <legend className="mb-2 text-xs font-semibold text-muted dark:text-muted-dark">縮小閱讀範圍</legend>
    {FACETS.map(key => <label key={key} className="min-w-0 text-xs text-body dark:text-body-dark">
      <span className="mb-1 block">{FACET_LABELS[key]}</span>
      <select aria-label={`篩選${FACET_LABELS[key]}`} value={value[key]} onChange={event => onChange(key, event.target.value)} className="min-h-11 w-full min-w-0 rounded border border-linestrong bg-surface px-2 text-sm dark:border-linestrong-dark dark:bg-surface-altdark">
        <option value="">所有{FACET_LABELS[key]}</option>
        {facetOptions(items, value, key).map(option => <option key={option.value} value={option.value}>{option.value}（{option.count}）</option>)}
      </select>
    </label>)}
  </fieldset>;
}
