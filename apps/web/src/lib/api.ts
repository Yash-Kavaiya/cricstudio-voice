import type { DestinationPublic, MatchDetail, MatchListItem, Platform, StudioCreateResponse, SttProvider, SttSettings } from '@cricstudio/shared';

export type CloudSttProvider = Exclude<SttProvider, 'browser'>;

/** Server origin. Empty = same origin (dev proxy / server-hosted web). Set VITE_API_URL when the web app is hosted separately (e.g. Vercel). */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
/** Absolute URL for a server path like /api/... or /uploads/... */
export const apiUrl = (path: string) => (path.startsWith('/') ? API_BASE + path : path);

async function req<T>(path: string, init: RequestInit & { hostToken?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json';
  if (init.hostToken) headers['x-host-token'] = init.hostToken;
  const res = await fetch(apiUrl(path), { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  matches: () => req<{ matches: MatchListItem[] }>('/api/matches').then((r) => r.matches),
  match: (key: string) => {
    const [l, e] = key.split(':');
    return req<{ match: MatchDetail }>(`/api/matches/${l}/${e}`).then((r) => r.match);
  },
  createStudio: (name: string, matchKey: string | null) =>
    req<StudioCreateResponse>('/api/studios', { method: 'POST', body: JSON.stringify({ name, matchKey }) }),
  studio: (id: string) => req<{ id: string; name: string; matchKey: string | null }>(`/api/studios/${id}`),
  saveStt: (id: string, hostToken: string, body: { provider?: SttProvider; language?: string; llmModel?: string; keys?: Partial<Record<CloudSttProvider, string | null>> }) =>
    req<{ stt: SttSettings }>(`/api/studios/${id}/stt`, { method: 'PUT', hostToken, body: JSON.stringify(body) }).then((r) => r.stt),
  testStt: (id: string, hostToken: string, provider: CloudSttProvider, key?: string) =>
    req<{ ok: boolean; error?: string; ms: number }>(`/api/studios/${id}/stt/test`, { method: 'POST', hostToken, body: JSON.stringify({ provider, key }) }),
  invite: (id: string, hostToken: string) => req<{ guestToken: string }>(`/api/studios/${id}/invite`, { hostToken }),
  destinations: (id: string, hostToken: string) =>
    req<{ destinations: DestinationPublic[] }>(`/api/studios/${id}/destinations`, { hostToken }).then((r) => r.destinations),
  addDestination: (id: string, hostToken: string, d: { platform: Platform; name?: string; url?: string; key: string }) =>
    req<{ destination: DestinationPublic }>(`/api/studios/${id}/destinations`, { method: 'POST', body: JSON.stringify(d), hostToken }),
  updateDestination: (id: string, hostToken: string, did: string, patch: Partial<{ name: string; url: string; key: string; enabled: boolean }>) =>
    req(`/api/studios/${id}/destinations/${did}`, { method: 'PATCH', body: JSON.stringify(patch), hostToken }),
  deleteDestination: (id: string, hostToken: string, did: string) =>
    req(`/api/studios/${id}/destinations/${did}`, { method: 'DELETE', hostToken }),
  uploadMusic: (id: string, hostToken: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ url: string; title: string }>(`/api/studios/${id}/music`, { method: 'POST', body: fd, hostToken });
  },
};
