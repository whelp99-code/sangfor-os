"use client";

import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";

export const COLLECTION_VIEWS = ["table", "kanban", "calendar", "timeline"] as const;
export type CollectionView = (typeof COLLECTION_VIEWS)[number];

/**
 * Shareable collection view state (view kind + search) stored in the URL.
 * Lets every CRM/PM collection toggle Table/Kanban/Calendar/Timeline on the
 * same dataset (monday/ClickUp pattern) without duplicating work.
 */
export function useCollectionView(defaultView: CollectionView = "table") {
  const [view, setView] = useQueryState(
    "view",
    parseAsStringEnum<CollectionView>([...COLLECTION_VIEWS]).withDefault(defaultView)
  );
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  return { view, setView, query, setQuery };
}
