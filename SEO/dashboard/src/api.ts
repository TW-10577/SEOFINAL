import { currentLang } from './i18n.ts';

// Thin fetch wrapper. All data comes from the API (database), never from local state.
export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // The server returns generated text (reasons, causes, evidence, report) in this language.
  const headers = new Headers(init?.headers);
  headers.set('X-Lang', currentLang());
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const postJson = <T,>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
