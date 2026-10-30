import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewHtml } from '../webview/render/html';

test('HTML and print exports carry an early CSP blocking network, file and script loads by default', () => {
  for (const print of [false, true]) {
    const html = previewHtml('<img src="http://127.0.0.1/beacon"><script>alert(1)</script>', '</title><script>bad()</script>', { width: 8.3, height: 11.7 }, print);
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<body>'));
    assert.match(html, /default-src 'none'; base-uri 'none'; form-action 'none'; img-src data:;/);
    assert.ok(!html.includes('<title></title><script>'));
    if (print) {
      const nonce = /script-src 'nonce-([a-f0-9]{32})'/.exec(html)![1];
      assert.ok(html.includes(`<script nonce="${nonce}">window.onload`));
    } else assert.match(html, /script-src 'none'/);
  }
  const optedIn = previewHtml('', '', { width: 8.3, height: 11.7 }, false, true);
  assert.match(optedIn, /img-src data: https:;/);
  assert.ok(!optedIn.includes(' http:'));
});
