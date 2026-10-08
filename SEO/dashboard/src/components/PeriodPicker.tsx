import type { Period } from '@seo/shared';
import { t } from '../i18n.ts';
import { period } from '../format.ts';

export interface WeekPeriod {
  current: Period;
  previous: Period;
}

export interface SourcePeriods {
  range: Period | null;
  periods: WeekPeriod[];
  /** Dates the export marks as not real (excluded unless test data is included). */
  synthetic?: string[];
}

const label = (p: WeekPeriod) => t('{current} vs {previous}', { current: period(p.current), previous: period(p.previous) });

/**
 * The analysis period detected from the uploaded data. A selector appears only when the data holds
 * more than one valid week-on-week period; otherwise the detected period is just shown.
 */
export function PeriodPicker({ title, data, value, onChange, emptyNote }: { title: string; data: SourcePeriods | undefined; value: string | undefined; onChange: (end: string) => void; emptyNote?: string }) {
  if (!data?.range)
    return emptyNote ? (
      <label className="field">
        {title}
        <span className="period-value caveat" style={{ fontWeight: 400, maxWidth: 360 }}>{emptyNote}</span>
      </label>
    ) : null;
  const chosen = data.periods.find((p) => p.current.end === value) ?? data.periods[0];
  return (
    <label className="field">
      {title}
      {data.periods.length > 1 ? (
        <select value={chosen!.current.end} onChange={(e) => onChange(e.target.value)}>
          {data.periods.map((p, i) => (
            <option key={p.current.end} value={p.current.end}>
              {label(p)}
              {i === 0 ? ` ${t('(latest)')}` : ''}
            </option>
          ))}
        </select>
      ) : chosen ? (
        <span className="period-value">{label(chosen)}</span>
      ) : (
        <span className="period-value caveat">{t('No complete week-on-week period (data: {range})', { range: period(data.range) })}</span>
      )}
    </label>
  );
}
