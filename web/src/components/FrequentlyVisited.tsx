import type { ReactNode } from 'react';
import { Item, StoreState, topVisited } from '@safari/shared';

/**
 * "Frequently Visited", computed from how often you actually open a tile from this
 * page (see `ItemStats`). Nothing is invented: until you have opened something at
 * least twice the section stays out of the way, which is also what Safari does.
 */
export function FrequentlyVisited({
  state,
  limit,
  renderTile,
  title,
  onClear,
}: {
  state: StoreState;
  limit: number;
  renderTile: (item: Item, visits: number) => ReactNode;
  title: string;
  onClear: () => void;
}) {
  const visited = topVisited(state, limit).filter(({ stats }) => stats.c > 1);
  if (visited.length < 2) return null;

  return (
    <section className="section" aria-label={title}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <button type="button" className="section-action" onClick={onClear} title="Forget visit counts">
          Reset
        </button>
      </div>
      <div className="frequent-row">{visited.map(({ item, stats }) => renderTile(item, stats.c))}</div>
    </section>
  );
}
