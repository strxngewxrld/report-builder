import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOpenMode } from '../src/layoutOpen';
import type { BcLayout } from '../webview/bc';

const layout = (uri: string, exists = true): BcLayout => ({ uri, exists, name: 'Layout', type: 'Custom', path: uri, owner: 'Report', current: false });

test('Layout links cannot launch executable files or protocol handlers declared by AL', () => {
  for (const uri of ['file:///C:/workspace/payload.exe', 'file:///C:/workspace/payload.cmd', 'command:workbench.action.terminal.new', 'https://evil.example/layout.docx', 'file:///C:/workspace/layout.docx%00.exe']) {
    assert.equal(layoutOpenMode(uri, [layout(uri)], true), undefined, uri);
  }
  const uri = 'file:///C:/workspace/layout.rdlc';
  assert.equal(layoutOpenMode(uri, [], true), undefined);
  assert.equal(layoutOpenMode(uri, [layout(uri, false)], true), undefined);
});

test('Restricted mode permits report design but does not launch Office files', () => {
  for (const uri of ['file:///C:/workspace/report.rdlc', 'vscode-remote://ssh-remote+host/workspace/report.rdl']) {
    assert.equal(layoutOpenMode(uri, [layout(uri)], false), 'designer');
  }
  for (const ext of ['docx', 'xlsx']) {
    const uri = `file:///C:/workspace/report.${ext}`;
    assert.equal(layoutOpenMode(uri, [layout(uri)], false), undefined);
    assert.equal(layoutOpenMode(uri, [layout(uri)], true), 'external');
  }
});
