import type { MeasurementRun } from '@seo/shared';
import { useEffect, useRef, useState } from 'react';
import { api, postJson, query } from './api.ts';
import type { SourcePeriods } from './components/PeriodPicker.tsx';

/**
 * The active import context: the file(s) being analysed and the analysis period derived from them. It lives in the
 * URL (#/seo/<page>?uploads=3,4&end=2026-09-23&run=12), so every tab — Data, Measurements, Report — follows it.
 * Empty uploads = all data (the Data tab opened directly).
 */
export interface ImportContext {
  uploads: number[];
  /** Last day of the current GA4 week; undefined until derived from the files' own data. */
  end?: string;
  /** The measurement run of this context, once known. */
  run?: number;
  /** Report page source: GA4 report (default) or the standalone GSC Performance Report. */
  report?: 'gsc';
}

export function parseContext(params: URLSearchParams): ImportContext {
  // ?upload=<id> is the older single-file link.
  const raw = params.get('uploads') ?? params.get('upload') ?? '';
  const uploads = [...new Set(raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const end = params.get('end') ?? undefined;
  return { uploads, end: end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : undefined, run: Number(params.get('run')) || undefined, report: params.get('report') === 'gsc' ? 'gsc' : undefined };
}

export function contextQuery(c: ImportContext): string {
  const p = new URLSearchParams();
  if (c.uploads.length) p.set('uploads', c.uploads.join(','));
  if (c.end) p.set('end', c.end);
  if (c.run) p.set('run', String(c.run));
  if (c.report) p.set('report', c.report);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** ?uploadIds=… for API requests; undefined when the context is all data. */
export const scopeParam = (c: ImportContext) => (c.uploads.length ? c.uploads.join(',') : undefined);

const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The run made for this context: same uploads, same current week, same test-data setting. */
export function matchRun(runs: MeasurementRun[], c: ImportContext, end: string, includeTest: boolean): MeasurementRun | undefined {
  return runs.find(
    (r) => sameIds([...r.scope.uploadIds].sort((a, b) => a - b), c.uploads) && r.current.end === end && (r.scope.includeTestData ?? true) === includeTest,
  );
}

/** Newest valid week of the context's GA4 data; the latest date when no complete week exists (results are then not evaluable). */
export const defaultEnd = (p: SourcePeriods | undefined) => p?.periods[0]?.current.end ?? p?.range?.end ?? undefined;

export interface ContextRun {
  /** The run to show: the context's run, or — without a context — the latest run. */
  runId: number | null;
  /** The period the context runs on (its own or derived from its files). */
  end: string | undefined;
  periods: Record<'GA4' | 'GSC', SourcePeriods> | null;
  runs: MeasurementRun[] | null;
  running: boolean;
  error: unknown;
  /** Measure the context again (e.g. "Run measurements"). */
  rerun: () => Promise<{ run: MeasurementRun; measurements: unknown[] } | null>;
  reloadRuns: () => void;
}

/**
 * Finds — or, when there is none yet, creates — the measurement run of the active context, so Measurements and
 * Report always follow the selected files and period and are never stale.
 */
export function useContextRun(ctx: ImportContext, includeTest: boolean): ContextRun {
  const scope = scopeParam(ctx);
  const [periods, setPeriods] = useState<Record<'GA4' | 'GSC', SourcePeriods> | null>(null);
  const [runs, setRuns] = useState<MeasurementRun[] | null>(null);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    setPeriods(null);
    api<Record<'GA4' | 'GSC', SourcePeriods>>(`/periods${query({ uploadIds: scope, includeTestData: includeTest ? 1 : 0 })}`)
      .then((p) => live && setPeriods(p))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [scope, includeTest]);
  useEffect(() => {
    let live = true;
    api<MeasurementRun[]>('/measurement-runs')
      .then((r) => live && setRuns(r))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [tick]);

  const hasContext = ctx.uploads.length > 0 || !!ctx.end;
  const end = ctx.end ?? (hasContext ? defaultEnd(periods?.GA4) : undefined);
  const match = runs && end ? matchRun(runs, ctx, end, includeTest) : undefined;
  const key = `${scope ?? 'all'}|${end}|${includeTest}`;

  async function rerun() {
    if (!end && hasContext) return null;
    setRunning(true);
    setError(null);
    try {
      const res = await postJson<{ run: MeasurementRun; measurements: unknown[] }>('/measurements/run', {
        currentEnd: end,
        includeTestData: includeTest,
        uploadIds: ctx.uploads.length ? ctx.uploads : undefined,
      });
      setTick((x) => x + 1);
      return res;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setRunning(false);
    }
  }

  // A context without its run yet: measure it once, automatically.
  useEffect(() => {
    if (!hasContext || ctx.run || !runs || !end || match || running || attempted.current.has(key)) return;
    attempted.current.add(key);
    void rerun();
  }, [hasContext, ctx.run, runs, end, match, running, key]);

  const runId = ctx.run ?? match?.id ?? (hasContext ? null : (runs?.[0]?.id ?? null));
  return { runId, end, periods, runs, running, error, rerun, reloadRuns: () => setTick((x) => x + 1) };
}
