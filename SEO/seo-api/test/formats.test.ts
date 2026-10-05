import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { SeoDatabase } from '../src/db.ts'
import { decodeText, readUpload } from '../src/fileformats.ts'
import { loadOntology } from '../src/ontology.ts'
import { SeoService } from '../src/service.ts'

const SEO_DIR = fileURLToPath(new URL('../../', import.meta.url))
const ontology = loadOntology(SEO_DIR)
const service = () => new SeoService(new SeoDatabase(':memory:'), ontology)

function single(items: ReturnType<SeoService['uploadFile']>) {
  assert.equal(items.length, 1)
  const [item] = items
  if ('error' in item && item.error) assert.fail(item.error)
  return item as Exclude<typeof item, { error: string }>
}

const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 7, 1 + i)))
const iso = (d: Date) => d.toISOString().slice(0, 10)
const chartRows = (sep: string) =>
  ['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'].join(sep) +
  '\n' +
  dates.map((d, i) => [iso(d), i < 7 ? 100 : 80, 1000, i < 7 ? '10%' : '8%', 3].join(sep)).join('\n')

function workbook(sheets: Record<string, unknown[][]>, bookType: XLSX.BookType = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name)
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
}

describe('upload file formats', () => {
  it('reads a tab-separated .txt file', () => {
    const item = single(service().uploadFile('chart.txt', Buffer.from(chartRows('\t'))))
    assert.equal(item.dataset.source, 'gsc-daily')
    assert.equal(item.dataset.rowCount, 14)
    assert.equal(item.anomalies.length, 2, 'clicks −20% and CTR −2 pt')
  })

  it('reads a .tsv file and a comma-separated .txt file', () => {
    assert.equal(single(service().uploadFile('chart.tsv', Buffer.from(chartRows('\t')))).dataset.rowCount, 14)
    assert.equal(single(service().uploadFile('chart.txt', Buffer.from(chartRows(',')))).dataset.rowCount, 14)
  })

  it('decodes Shift_JIS, UTF-16 and UTF-8 with BOM', () => {
    const sjis = readFileSync(new URL('./fixtures/sjis-gsc-chart.csv', import.meta.url))
    assert.ok(decodeText(sjis).startsWith('日付,クリック数'))
    assert.equal(single(service().uploadFile('sjis.csv', sjis)).dataset.rowCount, 14)

    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(chartRows('\t'), 'utf16le')])
    assert.equal(single(service().uploadFile('unicode.txt', utf16)).dataset.rowCount, 14)

    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(chartRows(','))])
    assert.ok(decodeText(bom).startsWith('日付'))
  })

  it('reads an .xlsx with real date cells and percent cells', () => {
    // Excel stores dates as local calendar days, so build local-midnight Date objects.
    const local = dates.map((d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const rows: unknown[][] = [['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'], ...local.map((d, i) => [d, i < 7 ? 100 : 80, 1000, 0.1, 3])]
    const buf = workbook({ チャート: rows })
    const wb = XLSX.read(buf, { cellNF: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    ws.D2.z = '0.00%'
    delete ws.D2.w
    const [sheet] = readUpload('chart.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    const lines = sheet.text.split('\n')
    assert.equal(lines[1].split(',')[0], '2026-08-01', 'date cell → YYYY-MM-DD')
    assert.equal(lines[1].split(',')[3], '10.00%', 'percent cell keeps its % text')

    const item = single(service().uploadFile('chart.xlsx', buf))
    assert.equal(item.dataset.source, 'gsc-daily')
    assert.equal(item.dataset.period?.start, '2026-08-01')
  })

  it('turns every sheet of a workbook into its own dataset and reports bad sheets separately', () => {
    const buf = workbook({
      日付: [['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'], ...dates.map((d) => [iso(d), 100, 1000, '10%', 3])],
      ページ: [
        ['上位のページ', 'クリック数', '表示回数', 'CTR', '掲載順位'],
        ['https://www.dospara.co.jp/', 10, 100, '10%', 2],
      ],
      メモ: [['自由記述'], ['これはデータではない']],
      空: [],
    })
    const items = service().uploadFile('gsc-export.xlsx', buf)
    assert.deepEqual(
      items.map((i) => [i.name, 'dataset' in i && i.dataset ? i.dataset.source : 'error']),
      [
        ['gsc-export.xlsx [日付]', 'gsc-daily'],
        ['gsc-export.xlsx [ページ]', 'gsc-pages'],
        ['gsc-export.xlsx [メモ]', 'error'],
      ],
    )
  })

  it('reads the legacy .xls format', () => {
    const buf = workbook({ Sheet1: [['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'], ...dates.map((d) => [iso(d), 100, 1000, '10%', 3])] }, 'biff8')
    assert.equal(single(service().uploadFile('old.xls', buf)).dataset.rowCount, 14)
  })

  it('rejects other file types and unreadable workbooks', () => {
    assert.throws(() => service().uploadFile('report.pdf', Buffer.from('x')), /Unsupported file type "\.pdf"/)
    assert.throws(() => service().uploadFile('broken.xlsx', Buffer.from('not a workbook')), /could not be read|No sheet|empty|Unrecognised/)
  })

  it('accepts YYYY/M/D dates from spreadsheet exports', () => {
    const text = chartRows(',').replace(/2026-08-0?(\d+)/g, (_m, d) => `2026/8/${d}`)
    assert.equal(single(service().uploadFile('slashes.csv', Buffer.from(text))).dataset.period?.start, '2026-08-01')
  })
})
