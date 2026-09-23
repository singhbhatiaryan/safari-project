/**
 * Netscape bookmark file (the format Chrome/Firefox/Safari export) → our item tree,
 * and back again.
 *
 * The format is pseudo-HTML: `<DT><H3>Folder</H3><DL>…</DL>` where the nested DL
 * may be a child of the DT *or* a following sibling, depending on the exporter.
 * The parser below handles both and never throws on junk.
 */
import { Item, StoreState } from './types';
import { createDefaultSettings, makeBookmark, now, uid } from './store';

const MAX_INLINE_ICON = 6144; // keep data-url icons only when they are small
const ICON_DEDUPE = new Set<string>();

export interface ParsedBookmarks {
  folders: Array<{ title: string; path: string[]; count: number }>;
  bookmarks: number;
  state: StoreState;
}

export function parseBookmarkHtml(html: string, baseState: StoreState): ParsedBookmarks {
  ICON_DEDUPE.clear();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('dl') ?? doc.body;
  const items: Item[] = baseState.items.filter((i) => !i.deletedAt);
  const folders: ParsedBookmarks['folders'] = [];
  let bookmarks = 0;
  const visited = new Set<Element>();
  const t = now();

  const parseList = (list: Element, parentId: string | null, path: string[]) => {
    if (visited.has(list)) return;
    visited.add(list);
    let lastFolderId: string | null = null;

    for (const node of Array.from(list.children)) {
      const tag = node.tagName.toUpperCase();
      if (tag === 'DT') {
        const heading = node.querySelector(':scope > h3');
        const anchor = node.querySelector(':scope > a');
        if (heading) {
          const title = (heading.textContent || '').trim() || 'Folder';
          const folder: Item = {
            id: uid(),
            type: 'folder',
            parentId,
            title,
            url: null,
            favicon: null,
            order: items.filter((i) => i.parentId === parentId).length,
            createdAt: t,
            updatedAt: t,
            deletedAt: null,
          };
          items.push(folder);
          lastFolderId = folder.id;
          const nested = node.querySelector(':scope > dl');
          const nextPath = [...path, title];
          if (nested) parseList(nested, folder.id, nextPath);
          folders.push({ title, path: nextPath, count: 0 });
        } else if (anchor) {
          const href = anchor.getAttribute('href');
          if (href && /^https?:/i.test(href)) {
            const title = (anchor.textContent || '').trim() || href;
            const icon = anchor.getAttribute('icon');
            const favicon =
              icon && icon.startsWith('data:') && icon.length <= MAX_INLINE_ICON && !ICON_DEDUPE.has(icon)
                ? (ICON_DEDUPE.add(icon), icon)
                : null;
            items.push(makeBookmark({ title: title.slice(0, 200), url: href, favicon: favicon ?? undefined }, parentId, items.filter((i) => i.parentId === parentId).length, t));
            bookmarks++;
            if (parentId) {
              const folder = folders.find((f) => f.path[f.path.length - 1] === path[path.length - 1]);
              if (folder) folder.count++;
            }
          }
        }
        continue;
      }
      if (tag === 'DL' && !visited.has(node)) {
        // Sibling form: the <DL> belongs to the folder announced just before it.
        parseList(node, lastFolderId ?? parentId, lastFolderId ? [...path, lastFolderOf(items, lastFolderId)] : path);
      }
    }
  };

  if (root) parseList(root, null, []);

  return {
    folders,
    bookmarks,
    state: {
      ...baseState,
      items: renumber(items),
      settings: baseState.settings ?? createDefaultSettings(),
      updatedAt: now(),
    },
  };
}

function lastFolderOf(items: Item[], id: string): string {
  return items.find((i) => i.id === id)?.title ?? '';
}

function renumber(items: Item[]): Item[] {
  const counters = new Map<string, number>();
  return items.map((item) => {
    const key = item.parentId ?? '__root__';
    const next = counters.get(key) ?? 0;
    counters.set(key, next + 1);
    return item.order === next ? item : { ...item, order: next };
  });
}

/** Exports the current page as a Netscape file Chrome can import (round-trips). */
export function toBookmarkHtml(state: StoreState): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const seconds = (ms: number) => Math.floor(ms / 1000);

  const render = (parentId: string | null, depth: number): string => {
    const pad = '    '.repeat(depth);
    const children = state.items
      .filter((i) => i.parentId === parentId && !i.deletedAt)
      .sort((a, b) => a.order - b.order);
    let out = '';
    for (const child of children) {
      if (child.type === 'folder') {
        out += `${pad}<DT><H3 ADD_DATE="${seconds(child.createdAt)}" LAST_MODIFIED="${seconds(child.updatedAt)}">${esc(child.title)}</H3>\n`;
        out += `${pad}<DL><p>\n`;
        out += render(child.id, depth + 1);
        out += `${pad}</DL><p>\n`;
      } else {
        const icon = child.favicon && child.favicon.startsWith('data:') ? ` ICON="${child.favicon}"` : '';
        out += `${pad}<DT><A HREF="${esc(child.url ?? '')}" ADD_DATE="${seconds(child.createdAt)}"${icon}>${esc(child.title)}</A>\n`;
      }
    }
    return out;
  };

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${render(null, 1)}</DL><p>
`;
}
