// Web client URL that runs a report, from the AL project's .vscode/launch.json (the configuration the AL extension
// publishes to). Pure.

export interface AlLaunchConfig {
  name?: string; type?: string; request?: string;
  server?: string; serverInstance?: string; tenant?: string; environmentType?: string; environmentName?: string;
  port?: number; authentication?: string; usePublicURLFromServer?: boolean;
}

const isCloud = (c: AlLaunchConfig) =>
  !c.server || /businesscentral\.dynamics\.com/i.test(c.server) || /^(sandbox|production)$/i.test(c.environmentType ?? '') && !c.serverInstance;

/**
 * On-prem: the developer endpoint's metadata (GET …/dev/metadata) names the web client ("webEndpoint", the server's
 * PublicWebBaseUrl). The web client often runs on another port than `server` (BC setup from the DVD: 8080), so the AL
 * extension opens this URL unless "usePublicURLFromServer" is false – Report Builder does the same.
 */
export function metadataUrl(c: AlLaunchConfig): string | undefined {
  if (isCloud(c) || c.usePublicURLFromServer === false) return undefined;
  const server = c.server!.replace(/\/+$/, '');
  const withPort = /:\d+$/.test(server.replace(/^\w+:\/\//, '')) ? server : `${server}:${c.port ?? 7049}`;
  const raw = `${withPort}/${encodeURIComponent(c.serverInstance ?? 'BC')}/dev/metadata${c.tenant && c.tenant !== 'default' ? `?tenant=${encodeURIComponent(c.tenant)}` : ''}`;
  // launch.json belongs to the workspace: only a well-formed http(s) URL, normalized (quotes and the like percent-encoded)
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.href.replace(/'/g, '%27') : undefined;
  } catch { return undefined; }
}

/** The web client base URL from the metadata response, or undefined when it is not usable. */
export function webEndpointOf(metadataJson: string): string | undefined {
  try {
    const url = (JSON.parse(metadataJson.replace(/^﻿/, '')) as { webEndpoint?: unknown }).webEndpoint;
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined;
  } catch { return undefined; }
}

/** Parses launch.json (JSON with comments and trailing commas) and returns its AL configurations. */
export function alConfigurations(launchJson: string): AlLaunchConfig[] {
  const json = launchJson
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string | undefined) => str ?? '')
    .replace(/,(\s*[}\]])/g, '$1');
  const parsed = JSON.parse(json) as { configurations?: AlLaunchConfig[] };
  return (parsed.configurations ?? []).filter(c => c.type === 'al' && (c.request ?? 'launch') === 'launch');
}

/** `webEndpoint`: the on-prem web client from the server's metadata (see metadataUrl); without it `server` is assumed. */
export function reportUrl(c: AlLaunchConfig, reportId: number, webEndpoint?: string): string {
  if (isCloud(c)) {
    const path = [c.tenant, c.environmentName ?? 'sandbox'].filter(Boolean).map(s => encodeURIComponent(s!)).join('/');
    return `https://businesscentral.dynamics.com/${path}/?report=${reportId}`;
  }
  const tenant = c.tenant && c.tenant !== 'default' ? `&tenant=${encodeURIComponent(c.tenant)}` : '';
  if (webEndpoint) return `${webEndpoint.replace(/[?#].*$/, '').replace(/\/*$/, '/')}?report=${reportId}${tenant}`;
  const server = c.server!.replace(/\/+$/, '');
  return `${server}/${encodeURIComponent(c.serverInstance ?? 'BC')}/?report=${reportId}${tenant}`;
}
