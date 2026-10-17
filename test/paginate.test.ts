import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../webview/render/paginate';

const rows = (from: number, n: number, h: number) => Array.from({ length: n }, (_, i) => ({ top: from + i * h, bottom: from + (i + 1) * h }));

test('breaks between rows, never inside', () => {
  const pages = paginate({ height: 1000, leaves: rows(0, 40, 25), keeps: [], forced: [], tables: [] }, 310);
  assert.deepEqual(pages.map(p => [p.start, p.end]), [[0, 300], [300, 600], [600, 900], [900, 1000]]);
});

test('forced group breaks and page number resets', () => {
  const pages = paginate({ height: 600, leaves: rows(0, 24, 25), keeps: [], forced: [{ y: 100, reset: true }, { y: 400, reset: true }], tables: [] }, 1000);
  assert.deepEqual(pages.map(p => [p.start, p.end, p.reset]), [[0, 100, false], [100, 400, true], [400, 600, true]]);
});

test('repeated table header reduces the space on following pages', () => {
  const pages = paginate({ height: 1000, leaves: rows(0, 40, 25), keeps: [], forced: [], tables: [{ key: 't', top: 0, bottom: 1000, headerBottom: 50 }] }, 300);
  assert.deepEqual(pages[0], { start: 0, end: 300, repeat: [], repeatHeight: 0, reset: false });
  assert.deepEqual(pages[1], { start: 300, end: 550, repeat: ['t'], repeatHeight: 50, reset: false });
});

test('keep together moves a block to the next page if it fits, else it is split', () => {
  const leaves = rows(0, 10, 25);
  const fits = paginate({ height: 600, leaves, keeps: [{ top: 200, bottom: 450 }], forced: [], tables: [] }, 300);
  assert.equal(fits[0].end, 200);
  // too large for a page: KeepTogether is ignored and the regular row break applies
  const tooBig = paginate({ height: 900, leaves: rows(0, 36, 25), keeps: [{ top: 100, bottom: 800 }], forced: [], tables: [] }, 310);
  assert.equal(tooBig[0].end, 300);
});

test('a single element taller than a page is cut', () => {
  const pages = paginate({ height: 500, leaves: [{ top: 0, bottom: 500 }], keeps: [], forced: [], tables: [] }, 200);
  assert.deepEqual(pages.map(p => [p.start, p.end]), [[0, 200], [200, 400], [400, 500]]);
});

test('empty body still gives one page', () => {
  assert.equal(paginate({ height: 0, leaves: [], keeps: [], forced: [], tables: [] }, 500).length, 1);
});
