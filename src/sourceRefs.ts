import type { SourceRef } from './types';
export function isSourceRef(value: unknown): value is SourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r=value as Record<string,unknown>;
  return Object.keys(r).length===2 && typeof r.id==='string' &&
    ((r.namespace==='rss-kb' && /^c[a-z0-9]{20,40}$/.test(r.id)) ||
     (r.namespace==='ethanai' && /^[1-9]\d*$/.test(r.id)));
}
/** Strip unexpected fields and deduplicate only within each namespace. */
export function sourceRefs(value: unknown): SourceRef[] {
  const valid=Array.isArray(value)?value.filter(isSourceRef):[];
  return [...new Map(valid.map(r=>[`${r.namespace}:${r.id}`,{namespace:r.namespace,id:r.id}])).values()]
    .sort((a,b)=>`${a.namespace}:${a.id}`.localeCompare(`${b.namespace}:${b.id}`));
}
