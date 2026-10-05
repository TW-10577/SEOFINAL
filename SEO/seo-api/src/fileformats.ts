import * as XLSX from 'xlsx'
import { UploadError } from './parsers.ts'

export const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xls']

export interface SheetText {
  name: string
  text: string
}

const extensionOf = (fileName: string) => {
  const i = fileName.lastIndexOf('.')
  return i < 0 ? '' : fileName.slice(i).toLowerCase()
}

// Excel on Japanese Windows saves CSV/TXT as Shift_JIS, and "Unicode text" as UTF-16 with a BOM.
export function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('shift_jis').decode(data)
  }
}

const csvField = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
const pad = (n: number) => String(n).padStart(2, '0')

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  if (cell.t === 'n' && cell.z !== undefined && XLSX.SSF.is_date(cell.z)) {
    const d = XLSX.SSF.parse_date_code(cell.v as number)
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`
  }
  // Percent cells hold a fraction (0.752); keep the displayed "75.2%" like the CSV exports do.
  if (cell.t === 'n' && typeof cell.w === 'string' && cell.w.trim().endsWith('%')) return cell.w.trim()
  if (cell.t === 'n') return String(cell.v)
  return String(cell.w ?? cell.v)
}

function sheetToCsv(ws: XLSX.WorkSheet): string {
  if (!ws['!ref']) return ''
  const range = XLSX.utils.decode_range(ws['!ref'])
  const lines: string[] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) row.push(csvField(cellText(ws[XLSX.utils.encode_cell({ r, c })])))
    if (row.some((v) => v !== '')) lines.push(row.join(','))
  }
  return lines.join('\n')
}

// Every sheet of a workbook becomes its own dataset, named "<file> [<sheet>]".
export function readUpload(fileName: string, data: Buffer): SheetText[] {
  const ext = extensionOf(fileName)
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new UploadError(`Unsupported file type "${ext || fileName}". Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}.`)
  }
  if (ext !== '.xlsx' && ext !== '.xls') return [{ name: fileName, text: decodeText(data) }]

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, { type: 'buffer', cellNF: true })
  } catch {
    throw new UploadError('The Excel file could not be read. Check that it opens in Excel and is not password protected.')
  }
  const sheets = wb.SheetNames.map((sheet) => ({ sheet, text: sheetToCsv(wb.Sheets[sheet]) })).filter((s) => s.text.trim() !== '')
  return sheets.map((s) => ({ name: sheets.length === 1 ? fileName : `${fileName} [${s.sheet}]`, text: s.text }))
}
