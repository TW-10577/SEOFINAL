import { useEffect, useState } from 'react';
import { period } from '../format.ts';
import { t } from '../i18n.ts';
import type { SourcePeriods } from './PeriodPicker.tsx';

// "Include test data": use the dates the uploaded file itself marks as not real (e.g. "# Fake data: 20260916-20260923").
// One switch for the Data and Measurements pages, kept per viewer in the browser.
const KEY = 'logos-seo-include-test-data';
const EVENT = 'logos-seo-test-data';

/** On by default: uploaded data flows through Data and Measurements; only an explicit "off" leaves test data out. */
function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function useTestData(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const set = (v: boolean) => {
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
    setOn(v);
    window.dispatchEvent(new Event(EVENT));
  };
  return [on, set];
}

const span = (dates: string[]) => (dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '');

/** Explains the dates the file marks as not real, with the switch to include them. Shown only when such dates exist. */
export function TestDataNotice({ ga4 }: { ga4: SourcePeriods | undefined }) {
  const [on, set] = useTestData();
  const fake = ga4?.synthetic ?? [];
  if (!fake.length) return null;
  const real = ga4?.range && !on ? ga4.range : null;
  const realDays = real ? Math.round((Date.parse(real.end) - Date.parse(real.start)) / 86400000) + 1 : 0;
  return (
    <div className={on ? 'notice warn' : 'notice'}>
      <div>
        {t('The uploaded GA4 file marks {range} as fake (test) data.', { range: span(fake) })}{' '}
        {on
          ? t('Test data is included: values and results that use it are labelled TEST DATA — not business results.')
          : real && t('Real data: {range} ({n} days). A week-on-week comparison needs 14 days, so test data is left out until you include it.', { range: period(real), n: realDays })}
      </div>
      <label className="row small" style={{ marginTop: 6, fontWeight: 600 }}>
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        {t('Include test data ({range})', { range: span(fake) })}
      </label>
    </div>
  );
}
