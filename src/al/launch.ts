// Web client URL that runs a report, from the AL project's .vscode/launch.json (the configuration the AL extension
// publishes to). Pure.

export interface AlLaunchConfig {
  name?: string; type?: string; request?: string;
  server?: string; serverInstance?: string; tenant?: string; environmentType?: string; environmentName?: string;
}

/** Parses launch.json (JSON with comments and trailing commas) and returns its AL configurations. */
export function alConfigurations(launchJson: string): AlLaunchConfig[] {
  const json = launchJson
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string | undefined) => str ?? '')
    .replace(/,(\s*[}\]])/g, '$1');
  const parsed = JSON.parse(json) as { configurations?: AlLaunchConfig[] };
  return (parsed.configurations ?? []).filter(c => c.type === 'al' && (c.request ?? 'launch') === 'launch');
}

export function reportUrl(c: AlLaunchConfig, reportId: number): string {
  const cloud = !c.server || /businesscentral\.dynamics\.com/i.test(c.server) || /^(sandbox|production)$/i.test(c.environmentType ?? '') && !c.serverInstance;
  if (cloud) {
    const path = [c.tenant, c.environmentName ?? 'sandbox'].filter(Boolean).map(s => encodeURIComponent(s!)).join('/');
    return `https://businesscentral.dynamics.com/${path}/?report=${reportId}`;
  }
  const server = c.server!.replace(/\/+$/, '');
  return `${server}/${encodeURIComponent(c.serverInstance ?? 'BC')}/?report=${reportId}${c.tenant && c.tenant !== 'default' ? `&tenant=${encodeURIComponent(c.tenant)}` : ''}`;
}
