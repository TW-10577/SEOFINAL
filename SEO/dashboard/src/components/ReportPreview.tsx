import type { Report } from '@seo/shared';
import { dateTime } from '../format.ts';
import { t } from '../i18n.ts';

export function ReportPreview({ report }: { report: Report }) {
  return (
    <div>
      <div className="small secondary" style={{ marginBottom: 8 }}>
        {t('{file} · report #{id} · generated {time} from measurement run #{run}', { file: report.fileName, id: report.id, time: dateTime(report.generatedAt), run: report.runId })}
      </div>
      <pre className="report">{report.content}</pre>
    </div>
  );
}
