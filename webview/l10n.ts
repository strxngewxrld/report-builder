// Localization shared by the extension host and the designer webview. Source strings are English; translations come
// from VS Code's bundle for the display language (l10n/bundle.l10n.<language>.json): the extension host loads it via
// vscode.l10n and passes it on to the webview. Placeholders are {0}, {1}, … as in vscode.l10n.t.

type Bundle = Record<string, string | { message: string; comment?: string[] }>;

let bundle: Bundle = {};
let language = 'en';

/** Sets the translations (vscode.l10n.bundle) and the display language (vscode.env.language). */
export function setLocalization(b: Bundle | undefined, lang = 'en') {
  bundle = b ?? {};
  language = lang;
}

/** The translations in use, to pass them to the webview. */
export const localization = () => ({ bundle, language });

const format = (s: string, args: unknown[]) => s.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));

export const l10n = {
  /** Translates a message; `args` fill the placeholders {0}, {1}, … */
  t(message: string, ...args: unknown[]): string {
    const entry = bundle[message];
    return format(entry === undefined ? message : typeof entry === 'string' ? entry : entry.message, args);
  },
  /** Display language (e.g. "de", "en") – for number and date formats of the user interface. */
  get language() { return language; },
};
