/** A standalone preview keeps the webview's resource restrictions when opened by the OS/browser. */
export function previewHtml(html: string, title: string, page: { width: number; height: number }, print: boolean, allowExternalImages = false): string {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const csp = `default-src 'none'; base-uri 'none'; form-action 'none'; img-src data:${allowExternalImages ? ' https:' : ''}; style-src 'unsafe-inline'; script-src ${print ? `'nonce-${nonce}'` : "'none'"};`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const width = Number.isFinite(page.width) && page.width > 0 ? page.width : 8.3;
  const height = Number.isFinite(page.height) && page.height > 0 ? page.height : 11.7;
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><title>${esc(title)}</title>
<style>@page { size: ${width}in ${height}in; margin: 0 } body { margin: 0; background: #eee } .rv-page { margin: 16px auto }
@media print { body { background: none } .rv-page { margin: 0 !important; box-shadow: none !important; break-after: page } }
.rv-interactive { display: none !important }</style></head>
<body>${html}${print ? `<script nonce="${nonce}">window.onload = () => setTimeout(() => window.print(), 300)</script>` : ''}</body></html>\n`;
}
