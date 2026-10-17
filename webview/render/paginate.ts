// Page breaking on measured body content (pixels, relative to the top of the body).
// Breaks never cut an unbreakable element (textbox, image, table row without nested tables); KeepTogether elements
// stay on one page when they fit; group page breaks are forced; table header rows marked RepeatOnNewPage are repeated
// on pages a table continues on.

export interface Interval { top: number; bottom: number }

export interface Measured {
  height: number;
  /** Elements that must not be split. */
  leaves: Interval[];
  /** KeepTogether elements (only honoured when they fit on a page). */
  keeps: Interval[];
  /** Forced breaks before these positions; `reset` restarts page numbering. */
  forced: { y: number; reset: boolean }[];
  /** Tables with repeated header rows: header occupies [top, headerBottom). */
  tables: { key: string; top: number; bottom: number; headerBottom: number }[];
}

export interface PageSlice {
  start: number;
  end: number;
  /** Tables whose header rows are repeated at the top of this page (outermost first). */
  repeat: string[];
  repeatHeight: number;
  /** Page numbering restarts on this page. */
  reset: boolean;
}

const EPS = 0.5;

function mergeBlocks(list: Interval[]): Interval[] {
  const sorted = [...list].filter(b => b.bottom - b.top > EPS).sort((a, b) => a.top - b.top);
  const out: Interval[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.top < last.bottom - EPS) last.bottom = Math.max(last.bottom, b.bottom);
    else out.push({ ...b });
  }
  return out;
}

export function paginate(m: Measured, available: number): PageSlice[] {
  const avail = Math.max(available, 20);
  const blocks = mergeBlocks([...m.leaves, ...m.keeps.filter(k => k.bottom - k.top <= avail)]);
  const forced = [...m.forced].sort((a, b) => a.y - b.y);
  const pages: PageSlice[] = [];
  let start = 0;
  let reset = false;
  while (start < m.height - EPS || pages.length === 0) {
    const repeatTables = m.tables.filter(t => t.headerBottom <= start + EPS && start < t.bottom - EPS && t.headerBottom > t.top);
    const repeatHeight = repeatTables.reduce((a, t) => a + (t.headerBottom - t.top), 0);
    const limit = start + Math.max(avail - repeatHeight, 20);
    let end: number;
    let nextReset = false;
    const f = forced.find(x => x.y > start + EPS);
    if (f && f.y <= limit + EPS) {
      end = f.y;
      nextReset = f.reset;
    } else if (limit >= m.height) {
      end = m.height;
    } else {
      // the block the limit falls into moves to the next page (unless it starts the page: then it is cut)
      const b = blocks.find(x => x.top < limit - EPS && limit < x.bottom - EPS);
      end = b && b.top > start + EPS ? b.top : limit;
    }
    pages.push({ start, end, repeat: repeatTables.map(t => t.key), repeatHeight, reset });
    reset = nextReset;
    if (end <= start + EPS) break; // safety: no progress
    start = end;
  }
  return pages;
}
