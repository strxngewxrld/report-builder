import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { l10n, setLocalization } from '../webview/l10n';
import { DesignerSession, ReportEditorProvider } from './reportEditorProvider';
import { serializeRdl } from '../webview/rdl';
import { newReportTemplate } from '../webview/templates';
import { probes, testing } from './testing';
import { LayoutService } from './layoutService';
import { registerBcCommands } from './bcCommands';
import { checkForUpdates, downloadVsix } from './updateCheck';

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Commands the webview carries out itself (toolbar, context menu, command palette). */
const WEBVIEW_COMMANDS = [
  'findExpressions', 'saveBlock', 'insertBlock',
  'togglePreview', 'reportProperties', 'print', 'exportHtml', 'zoomIn', 'zoomOut', 'zoomReset',
  'toggleOutline', 'toggleReportData', 'toggleProperties', 'toggleHeader', 'toggleFooter',
  'insert.textbox', 'insert.table', 'insert.image', 'insert.line', 'insert.rectangle',
  'editText', 'editExpression', 'cut', 'copy', 'paste', 'delete', 'bringToFront', 'sendToBack',
  'table.insertColumnLeft', 'table.insertColumnRight', 'table.deleteColumn', 'table.toggleHeaderRow', 'table.toggleFooterRow', 'table.select',
  'importSampleData', 'data.edit', 'data.delete', 'exportPdf', 'exportExcel', 'exportWord', 'insert.chart', 'insert.matrix', 'chart.properties',
  ...['addParentGroup', 'addChildGroup', 'addColumnGroup', 'deleteColumnGroup', 'deleteColumnGroupOnly', 'groupProperties', 'addGroupHeader', 'addGroupFooter', 'deleteGroup', 'deleteGroupOnly',
    'insertRowAbove', 'insertRowBelow', 'insertRowOutsideAbove', 'insertRowOutsideBelow', 'deleteRow', 'mergeCells', 'splitCell'].map(c => `table.${c}`),
  ...['alignLeft', 'alignCenter', 'alignRight', 'alignTop', 'alignMiddle', 'alignBottom', 'sameWidth', 'sameHeight', 'sameSize',
    'distributeHorizontal', 'distributeVertical', 'centerHorizontal', 'centerVertical'].map(c => `layout.${c}`),
];

/** Context of a native webview context menu entry (data-vscode-context of the clicked element). */
type MenuContext = { webview?: string; line?: number; character?: number; expression?: string; [k: string]: unknown };
const menuContext = (arg: unknown): MenuContext | undefined =>
  arg && typeof arg === 'object' && !(arg instanceof vscode.Uri) ? arg as MenuContext : undefined;

/** Settings toggled from the editor title's "View" submenu, like VS Code's own View › Toggle … commands. */
const SETTING_TOGGLES: Record<string, string> = { toggleRuler: 'showRuler', toggleGrid: 'showGrid', toggleSnap: 'snapToGrid' };

export function activate(context: vscode.ExtensionContext) {
  // translations for code shared with the webview (and passed on to it); the integration tests can force a language
  const forced = testing ? process.env.BC_RB_TEST_LANGUAGE : undefined;
  if (forced) {
    const file = vscode.Uri.joinPath(context.extensionUri, 'l10n', `bundle.l10n.${forced}.json`).fsPath;
    setLocalization(JSON.parse(readFileSync(file, 'utf8')), forced);
  } else {
    setLocalization(vscode.l10n.bundle, vscode.env.language);
  }
  const service = new LayoutService();
  const api = testing ? { probes, service } : undefined;
  const command = (id: string, fn: (...args: any[]) => unknown) => vscode.commands.registerCommand(`bcReportBuilder.${id}`, fn);
  /** The designer a command applies to: the one of the resource it was invoked on, else the active one. */
  const target = (uri?: unknown): DesignerSession | undefined =>
    (uri instanceof vscode.Uri ? ReportEditorProvider.sessionFor(uri) : undefined) ?? ReportEditorProvider.active;

  context.subscriptions.push(
    service,
    vscode.window.registerCustomEditorProvider(ReportEditorProvider.viewType, new ReportEditorProvider(context, service), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    new DesignerStatus(),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('bcReportBuilder.designer')) ReportEditorProvider.broadcastConfig();
    }),

    command('newReport', async (folder?: vscode.Uri) => {
      const base = folder instanceof vscode.Uri ? folder : vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = await vscode.window.showSaveDialog({
        defaultUri: base ? vscode.Uri.joinPath(base, `${l10n.t('Report1')}.rdlc`) : undefined,
        filters: { [l10n.t('RDLC Layout')]: ['rdlc'], [l10n.t('Report Definition')]: ['rdl'] },
        saveLabel: l10n.t('Create Layout'),
      });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(serializeRdl(newReportTemplate())));
      await vscode.commands.executeCommand('vscode.openWith', target, ReportEditorProvider.viewType);
    }),

    // from a context menu the argument is the clicked element's context, which the webview handler receives
    ...WEBVIEW_COMMANDS.map(id => command(id, (arg?: unknown) => target(arg)?.command(id, menuContext(arg)))),
    command('showPreview', (uri?: unknown) => target(uri)?.command('setMode', 'preview')),
    command('showDesign', (uri?: unknown) => target(uri)?.command('setMode', 'design')),
    command('revealAl', () => ReportEditorProvider.active?.revealAl()),
    command('goToAlDefinition', (arg?: unknown) => {
      const ctx = menuContext(arg);
      if (ctx?.line !== undefined) return ReportEditorProvider.active?.revealAl(ctx.line, ctx.character ?? 0);
    }),
    command('copyExpression', async (arg?: unknown) => {
      const expression = menuContext(arg)?.expression;
      if (!expression) return;
      await vscode.env.clipboard.writeText(expression);
      vscode.window.setStatusBarMessage(`$(copy) ${l10n.t('{0} copied', expression)}`, 2500);
    }),

    ...Object.entries(SETTING_TOGGLES).map(([id, key]) => command(id, async () => {
      const config = vscode.workspace.getConfiguration('bcReportBuilder.designer');
      await config.update(key, !config.get<boolean>(key, true), vscode.ConfigurationTarget.Global);
    })),

    command('zoom', async () => {
      const session = ReportEditorProvider.active;
      if (!session) return;
      const current = session.state?.zoom ?? 1;
      const picked = await vscode.window.showQuickPick(
        ZOOM_LEVELS.map(z => ({ label: `${Math.round(z * 100)} %`, zoom: z, description: z === current ? l10n.t('current') : undefined })),
        { placeHolder: l10n.t('Choose the zoom level'), title: l10n.t('Zoom') });
      if (picked) await session.command('setZoom', picked.zoom);
    }),

    command('changeUnit', async () => {
      const session = ReportEditorProvider.active;
      if (!session) return;
      const current = session.state?.unit;
      const picked = await vscode.window.showQuickPick(
        [{ label: l10n.t('Centimeters'), unit: 'cm' }, { label: l10n.t('Inches'), unit: 'in' }].map(u => ({ ...u, description: u.unit === current ? l10n.t('current') : undefined })),
        { placeHolder: l10n.t('Unit of measurement of the report (rd:ReportUnitType)'), title: l10n.t('Unit of Measurement') });
      if (picked && picked.unit !== current) await session.command('setUnit', picked.unit);
    }),

    command('openAsXml', async (uri?: vscode.Uri) => {
      const resource = uri instanceof vscode.Uri ? uri : activeResource();
      if (resource) await vscode.commands.executeCommand('vscode.openWith', resource, 'default', uri ? undefined : vscode.ViewColumn.Beside);
    }),

    command('openInDesigner', async (uri?: vscode.Uri) => {
      const resource = uri instanceof vscode.Uri ? uri : activeResource();
      if (resource) await vscode.commands.executeCommand('vscode.openWith', resource, ReportEditorProvider.viewType);
    }),
  );
  registerBcCommands(context, service);
  void startUpdateCheck(context).catch(() => undefined);
  return api;
}

const SKIPPED_VERSION_KEY = 'bcReportBuilder.skippedUpdateVersion';

/** Offers a newer version from GitHub Releases (once per start): install its VSIX, open the release or skip it. */
async function startUpdateCheck(context: vscode.ExtensionContext): Promise<void> {
  if (testing || context.extensionMode === vscode.ExtensionMode.Test) return;
  if (!vscode.workspace.getConfiguration('bcReportBuilder').get<boolean>('checkForUpdates', true)) return;
  const manifest = context.extension.packageJSON as { version: string; repository?: { url?: string } };
  const openRelease = (url: string) => void vscode.env.openExternal(vscode.Uri.parse(url, true));
  await checkForUpdates({
    current: manifest.version,
    repositoryUrl: manifest.repository?.url ?? '',
    fetch,
    skipped: context.globalState.get<string>(SKIPPED_VERSION_KEY),
    async notify(release) {
      const install = l10n.t('Install'), open = l10n.t('Open Release'), skip = l10n.t('Skip This Version');
      const choice = await vscode.window.showInformationMessage(
        l10n.t('Business Central Report Builder {0} is available (installed: {1}).', release.version, manifest.version),
        ...(release.vsix ? [install] : []), open, skip);
      return choice === install ? 'install' : choice === open ? 'open' : choice === skip ? 'skip' : undefined;
    },
    async install(release) {
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: l10n.t('Installing Business Central Report Builder {0}…', release.version),
        }, async () => {
          const bytes = await downloadVsix(release.vsix, fetch);
          // installFromVSIX only accepts file: URIs; globalStorageUri may use vscode-userdata:
          const dir = await mkdtemp(join(tmpdir(), 'bc-report-builder-update-'));
          try {
            const file = join(dir, basename(release.vsix.name));
            await writeFile(file, bytes);
            await vscode.commands.executeCommand('workbench.extensions.command.installFromVSIX', [vscode.Uri.file(file)]);
          } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          }
        });
        // VS Code itself offers to restart the extensions after installing the VSIX
      } catch (error) {
        const open = l10n.t('Open Release');
        const reason = error instanceof Error ? error.message : String(error);
        const choice = await vscode.window.showErrorMessage(
          l10n.t('Could not install Business Central Report Builder {0}: {1}', release.version, reason), open);
        if (choice === open) openRelease(release.url);
      }
    },
    open: openRelease,
    skip: version => void context.globalState.update(SKIPPED_VERSION_KEY, version),
  });
}

/** Resource of the active editor tab (designer or text editor). */
function activeResource(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
  return undefined;
}

/**
 * Status bar entries and context keys of the active designer – like the text editor's "Ln, Col", encoding and
 * language entries, they appear only while a designer has focus.
 */
class DesignerStatus implements vscode.Disposable {
  private readonly selection = this.item('selection', l10n.t('Selection'), 104);
  private readonly page = this.item('page', l10n.t('Page'), 103);
  private readonly unit = this.item('unit', l10n.t('Unit of Measurement'), 102, 'bcReportBuilder.changeUnit', l10n.t('Change Unit of Measurement'));
  private readonly zoom = this.item('zoom', l10n.t('Zoom'), 101, 'bcReportBuilder.zoom', l10n.t('Choose the zoom level'));
  private readonly al = this.item('al', l10n.t('AL Report'), 100, 'bcReportBuilder.revealAl');
  private readonly subscription = ReportEditorProvider.onDidChange(s => this.update(s));
  private readonly keys = new Map<string, unknown>();

  constructor() { this.update(ReportEditorProvider.active); }

  private item(id: string, name: string, priority: number, command?: string, tooltip?: string) {
    const item = vscode.window.createStatusBarItem(`bcReportBuilder.${id}`, vscode.StatusBarAlignment.Right, priority);
    item.name = `Report Builder: ${name}`;
    item.command = command;
    item.tooltip = tooltip;
    return item;
  }

  private setContext(key: string, value: unknown) {
    if (this.keys.get(key) === value) return;
    this.keys.set(key, value);
    vscode.commands.executeCommand('setContext', `bcReportBuilder.${key}`, value);
  }

  private update(session: DesignerSession | undefined) {
    const s = session?.state;
    const show = (item: vscode.StatusBarItem, text: string | undefined) => {
      if (text) { item.text = text; item.show(); } else item.hide();
    };
    show(this.selection, s?.mode === 'design' ? s.status : undefined);
    show(this.page, s?.mode === 'preview' && s.page ? l10n.t('Page {0} of {1}', s.page.current, s.page.total) : undefined);
    show(this.unit, s && (s.unit === 'cm' ? l10n.t('Centimeters') : l10n.t('Inches')));
    show(this.zoom, s && `$(zoom-in) ${Math.round(s.zoom * 100)} %`);
    const bc = session?.bc;
    show(this.al, bc ? `$(symbol-class) ${bc.reportName}` : undefined);
    if (bc) this.al.tooltip = new vscode.MarkdownString(`**${bc.kind === 'reportextension' ? l10n.t('Report extension {0} "{1}"', bc.id, bc.reportName) : l10n.t('Report {0} "{1}"', bc.id, bc.reportName)}**\n\n${bc.alFile}\n\n${l10n.t('Click to open the AL code')}`);

    this.setContext('mode', s?.mode ?? 'design');
    this.setContext('hasAlReport', !!bc);
    this.setContext('hasSelection', !!s?.hasSelection);
    this.setContext('canPaste', !!s?.canPaste);
    this.setContext('hasHeader', !!s?.hasHeader);
    this.setContext('hasFooter', !!s?.hasFooter);
    this.setContext('outlineVisible', !!s?.panes.outline);
    this.setContext('reportDataVisible', !!s?.panes.reportData);
    this.setContext('propertiesVisible', !!s?.panes.properties);
  }

  dispose() {
    this.subscription.dispose();
    for (const i of [this.selection, this.page, this.unit, this.zoom, this.al]) i.dispose();
  }
}

export function deactivate() {}
