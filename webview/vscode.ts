interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi = typeof acquireVsCodeApi === 'function'
  ? acquireVsCodeApi()
  : { postMessage: m => console.log('postMessage', m), getState: () => undefined, setState: () => undefined };

export const vscode = api;

/** Messages webview → extension (mirrors FromWebview in src/reportEditorProvider.ts). */
export type ToExtension =
  | { type: 'ready' }
  | { type: 'testDomResult'; id: number; text?: string; count?: number; error?: string }
  | { type: 'edit'; text: string }
  | { type: 'importSampleData'; dataSet?: string }
  | { type: 'exportHtml'; html: string }
  | { type: 'print'; html: string }
  | { type: 'openXml' }
  | { type: 'error'; message: string }
  | { type: 'info'; message: string }
  | { type: 'openLink'; url: string }
  | { type: 'pickImage' }
  | { type: 'saveBlock'; text: string }
  | { type: 'pickBlock' }
  | { type: 'openLayout'; uri: string }
  | { type: 'savePdf'; name: string; data: string }
  | { type: 'fonts'; id: number; requests: FontRequest[] }
  | { type: 'loaded'; items: number; raw: number }
  | { type: 'revealAl'; line: number; character: number }
  | { type: 'showProblems' }
  | { type: 'previewReady'; pages: number; errors: number }
  | { type: 'state'; state: DesignerState }
  | { type: 'run'; command: string; args?: unknown[] }
  | { type: 'exportDocument'; format: 'xlsx' | 'docx'; blocks: unknown[]; page: { width: number; height: number; margins: [number, number, number, number] } };

/** Mirrors DesignerState in src/reportEditorProvider.ts (status bar, context keys). */
export interface DesignerState {
  mode: 'design' | 'preview';
  zoom: number;
  unit: 'in' | 'cm';
  status: string;
  hasSelection: boolean;
  canPaste: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  panes: { outline: boolean; reportData: boolean; properties: boolean };
  page?: { current: number; total: number };
}

/** Mirrors DesignerConfig in src/reportEditorProvider.ts (bcReportBuilder.designer.* settings). */
export interface DesignerConfig { grid: boolean; snap: boolean; ruler: boolean; defaultZoom: number }

export const post = (msg: ToExtension) => api.postMessage(msg);

/** A font family list (CSS order) and style the PDF export needs; mirrors src/fonts.ts. */
export interface FontRequest { families: string[]; bold: boolean; italic: boolean }

let fontRequests = 0;
/**
 * Asks the extension for the installed font files of the requests (base64, null where none is found). Outside of
 * VS Code, or when the extension does not answer in time, every font is null and the PDF uses the standard fonts.
 */
export function requestFonts(requests: FontRequest[], timeout = 15000): Promise<(string | null)[]> {
  const none = requests.map(() => null);
  if (typeof acquireVsCodeApi !== 'function' || !requests.length) return Promise.resolve(none);
  const id = ++fontRequests;
  return new Promise(resolve => {
    const done = (fonts: (string | null)[]) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(fonts);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'fonts' && e.data.id === id) done(e.data.fonts);
    };
    const timer = setTimeout(() => done(none), timeout);
    window.addEventListener('message', onMessage);
    post({ type: 'fonts', id, requests });
  });
}

/**
 * Context for VS Code's native webview context menu (menus › webview/context in package.json): VS Code merges the
 * data-vscode-context of the clicked element and its ancestors, evaluates the menus' when clauses against it and
 * passes it to the command.
 */
export const vsContext = (ctx: Record<string, string | number | boolean>) => ({ 'data-vscode-context': JSON.stringify(ctx) });
