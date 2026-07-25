import type { PageInfo } from "@sangfor/business";

export interface CollectionQueryParams {
  first?: number;
  after?: string;
  before?: string;
  query?: string;
  sort?: string;
  direction?: "asc" | "desc";
}

export function buildCollectionQueryString(params: CollectionQueryParams): string {
  const sp = new URLSearchParams();
  if (params.first) sp.set("first", String(params.first));
  if (params.after) sp.set("after", params.after);
  if (params.before) sp.set("before", params.before);
  if (params.query) sp.set("query", params.query);
  if (params.sort) sp.set("sort", params.sort);
  if (params.direction) sp.set("direction", params.direction);
  return sp.toString();
}
