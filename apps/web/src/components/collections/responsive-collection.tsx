import type { ReactNode } from "react";

type Props<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
};

export function ResponsiveCollection<T>({ items, getKey, renderItem }: Props<T>) {
  return (
    <ul
      className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]"
      data-responsive-collection="single-dom"
    >
      {items.map((item) => (
        <li key={getKey(item)} data-record-id={getKey(item)}>
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}
