import { normalizeDate, parseCsv, parseNumber } from './csv.ts'
import type { ParsedFile, SegmentLabels, SnapshotRow } from './types.ts'

export class UploadError extends Error {}

const GSC_BREAKDOWNS = ['デバイス', '国', '検索での見え方', 'フィルタ']

// Tab-separated when the first data line has more tabs than commas (GA4 TSV, Excel "text (tab delimited)").
function delimiterOf(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '' && !l.trim().startsWith('#')) ?? ''
  return (line.match(/\t/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? '\t' : ','
}

export function parseUpload(text: string): ParsedFile {
  const rows = parseCsv(text, delimiterOf(text)).filter((r) => r.some((c) => c.trim() !== ''))
  const body = rows.filter((r) => !r[0].trim().startsWith('#'))
  if (body.length === 0) throw new UploadError('The file has no data rows.')

  const first = body[0][0].trim()
  const header = body[0].map((h) => h.trim())
  if (first === '日付' && (header.includes('ページ') || header.includes('クエリ'))) {
    throw new UploadError(
      'Page- and query-level daily exports are recognised but not analysed yet: comparison currently runs on the site-level date chart and GA4 channel data only.',
    )
  }
  if (first === '日付' && header.includes('クリック数')) return parseGscDaily(body)
  if (first === 'セグメント') return parseGa4(body)
  if (first === '上位のページ') return parseGscSnapshot(body, 'gsc-pages')
  if (first === '上位のクエリ') return parseGscSnapshot(body, 'gsc-queries')
  if (GSC_BREAKDOWNS.includes(first)) {
    return {
      source: 'gsc-other',
      rowCount: body.length - 1,
      warnings: [`「${first}」 breakdown stored for reference only: it has no dates, so no period comparison is possible.`],
    }
  }
  throw new UploadError(
    `Unrecognised file format (first header cell: "${first}"). Supported: GSC 平均読み込み時間のチャート / ページ / クエリ exports and GA4 自由形式 exports, as CSV.`,
  )
}

function requireColumn(header: string[], name: string): number {
  const i = header.findIndex((h) => h.trim() === name)
  if (i < 0) throw new UploadError(`Required column 「${name}」 is missing.`)
  return i
}

function parseGscDaily(body: string[][]): ParsedFile {
  const header = body[0]
  const iClicks = requireColumn(header, 'クリック数')
  const iImpr = requireColumn(header, '表示回数')
  const iPos = requireColumn(header, '掲載順位')
  const daily: Record<string, Record<string, number>> = {}
  const warnings: string[] = []

  for (const [n, r] of body.slice(1).entries()) {
    const line = n + 2
    const date = normalizeDate(r[0])
    const clicks = parseNumber(r[iClicks])
    const impressions = parseNumber(r[iImpr])
    const position = parseNumber(r[iPos])
    if (!date) {
      warnings.push(`Row ${line}: invalid date "${r[0]}", skipped.`)
      continue
    }
    if (clicks === null || impressions === null || position === null) {
      warnings.push(`Row ${line} (${date}): missing clicks, impressions or position, skipped.`)
      continue
    }
    if (daily[date]) {
      warnings.push(`Row ${line}: duplicate date ${date}, kept the first row.`)
      continue
    }
    daily[date] = { clicks, impressions, positionWeighted: position * impressions }
  }
  if (Object.keys(daily).length === 0) throw new UploadError('No valid daily rows found.')
  return { source: 'gsc-daily', daily, rowCount: Object.keys(daily).length, warnings }
}

function metricKeyFor(name: string): 'sessions' | 'purchases' | null {
  if (name === 'セッション') return 'sessions'
  if (name === 'e コマース購入数' || name === 'トランザクション') return 'purchases'
  return null
}

function parseGa4(body: string[][]): ParsedFile {
  const segRow = body[0]
  const metricRow = body[1]
  if (!metricRow) throw new UploadError('GA4 export has a segment row but no metric row.')
  const warnings: string[] = []

  const names = [...new Set(segRow.slice(1).map((s) => s.trim()).filter(Boolean))]
  if (names.length === 0) throw new UploadError('GA4 export has no segments.')
  const segments: SegmentLabels = { total: names[0] }
  const roleOf = new Map<string, string>([[names[0], 'total']])
  for (const name of names.slice(1)) {
    const role = name.includes('オーガニック')
      ? 'organic'
      : name.includes('ペイド') || name.includes('広告')
        ? 'paid'
        : name.includes('ダイレクト')
          ? 'direct'
          : null
    if (role && !roleOf.has(name) && !(role in segments)) {
      segments[role as 'organic' | 'paid' | 'direct'] = name
      roleOf.set(name, role)
    }
  }

  const columns: { index: number; key: string }[] = []
  const ignored = new Set<string>()
  for (let i = 1; i < segRow.length; i++) {
    const role = roleOf.get(segRow[i].trim())
    const metric = metricKeyFor((metricRow[i] ?? '').trim())
    if (!role) continue
    if (!metric) {
      if (metricRow[i]?.trim()) ignored.add(metricRow[i].trim())
      continue
    }
    columns.push({ index: i, key: `${role}:${metric}` })
  }
  if (ignored.size > 0) warnings.push(`Metrics not used in analysis: ${[...ignored].join(', ')}.`)
  if (!columns.some((c) => c.key === 'total:sessions')) {
    throw new UploadError(`GA4 export has no セッション column for segment 「${segments.total}」.`)
  }

  const daily: Record<string, Record<string, number>> = {}
  for (const [n, r] of body.slice(2).entries()) {
    const date = normalizeDate(r[0] ?? '')
    if (!date) continue
    const values: Record<string, number> = {}
    for (const c of columns) {
      const v = parseNumber(r[c.index])
      if (v === null) warnings.push(`Row ${n + 3} (${date}): missing ${c.key}.`)
      else values[c.key] = v
    }
    if (daily[date]) {
      warnings.push(`Duplicate date ${date}, kept the first row.`)
      continue
    }
    daily[date] = values
  }

  if (Object.keys(daily).length === 0) {
    warnings.push('This GA4 export has totals only (no 日付 rows), so no period comparison is possible.')
    return { source: 'ga4-snapshot', segments, rowCount: Math.max(0, body.length - 2), warnings }
  }
  return { source: 'ga4-daily', daily, segments, rowCount: Object.keys(daily).length, warnings }
}

function parseGscSnapshot(body: string[][], source: 'gsc-pages' | 'gsc-queries'): ParsedFile {
  const header = body[0]
  const iClicks = requireColumn(header, 'クリック数')
  const iImpr = requireColumn(header, '表示回数')
  const iCtr = requireColumn(header, 'CTR')
  const iPos = requireColumn(header, '掲載順位')
  const snapshot: SnapshotRow[] = []
  let skipped = 0
  for (const r of body.slice(1)) {
    const clicks = parseNumber(r[iClicks])
    const impressions = parseNumber(r[iImpr])
    const ctr = parseNumber(r[iCtr])
    const position = parseNumber(r[iPos])
    if (!r[0]?.trim() || clicks === null || impressions === null || ctr === null || position === null) {
      skipped++
      continue
    }
    snapshot.push({ key: r[0].trim(), clicks, impressions, ctr, position })
  }
  const warnings = [
    'Snapshot export (one total for the whole period, no dates), stored for reference; no period comparison is possible.',
  ]
  if (skipped > 0) warnings.push(`${skipped} row(s) with missing values skipped.`)
  return { source, snapshot, rowCount: snapshot.length, warnings }
}
