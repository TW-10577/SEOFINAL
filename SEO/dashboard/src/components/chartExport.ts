// Formatted Excel report for a chart card, built in the browser from what the card shows: the chart's own svg
// (drawn to a PNG with its resolved colours) and the rows of the file behind it.

/** Presentation properties copied from the page's computed style, so the image looks like the card (CSS variables included). */
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility',
];

export interface ChartImage {
  dataUrl: string;
  /** Size in CSS pixels (the bitmap is `scale` times larger). */
  width: number;
  height: number;
}

const PAD = 24;

/** The card's chart as a PNG: title and subtitle on top, the chart below, on the card's background colour. */
export async function chartToPng(svg: SVGSVGElement, title: string, subtitle: string, scale = 2): Promise<ChartImage> {
  const vb = svg.viewBox.baseVal;
  const w = vb?.width || svg.clientWidth || 640;
  const h = vb?.height || svg.clientHeight || 240;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = dst[i] as SVGElement;
    for (const p of STYLE_PROPS) target.style.setProperty(p, cs.getPropertyValue(p));
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.removeAttribute('hidden');
  clone.style.display = 'block';

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await img.decode();

  const card = svg.closest('.card') ?? document.body;
  const bg = getComputedStyle(card).backgroundColor || '#ffffff';
  const ink = getComputedStyle(document.body).color || '#111111';
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666';
  const font = getComputedStyle(document.body).fontFamily;

  const header = subtitle ? 64 : 44;
  const width = w + PAD * 2;
  const height = header + h + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ink;
  ctx.font = `600 16px ${font}`;
  ctx.fillText(title, PAD, PAD + 8, width - PAD * 2);
  if (subtitle) {
    ctx.fillStyle = muted;
    ctx.font = `12px ${font}`;
    ctx.fillText(subtitle, PAD, PAD + 30, width - PAD * 2);
  }
  ctx.drawImage(img, PAD, header, w, h);

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

export interface ReportTable {
  fileName: string;
  table: string;
  columns: string[];
  rows: (string | number)[][];
}

/** CSS colour (rgb(...) or #hex) → Excel ARGB. */
function argb(css: string, fallback: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (m) return `FF${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  return hex ? `FF${hex[1]!.toUpperCase()}` : fallback;
}

/** Brand colour of the page, resolved from its CSS variable. */
function brandArgb(): string {
  const probe = document.createElement('span');
  probe.style.color = 'var(--brand-700)';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return argb(c, 'FF1F5F99');
}

/**
 * Formatted Excel report: title, subtitle and source line, the chart image, then the data table with a coloured
 * header, banded rows, number formats, a data bar on the first numeric column and a filter on the header.
 */
export async function formattedReport(img: ChartImage, title: string, subtitle: string, data: ReportTable, note: string): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet('Report', { views: [{ showGridLines: false }] });
  const brand = brandArgb();
  const lastCol = Math.max(data.columns.length, 1);

  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: brand } };
  if (subtitle) {
    ws.getCell(2, 1).value = subtitle;
    ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF6B7280' } };
  }
  ws.getCell(3, 1).value = note;
  ws.getCell(3, 1).font = { size: 10, color: { argb: 'FF6B7280' } };

  // Chart image under the heading, at most 720 px wide.
  const dispW = Math.min(720, img.width);
  const dispH = Math.round((img.height * dispW) / img.width);
  const imageId = wb.addImage({ base64: img.dataUrl, extension: 'png' });
  ws.addImage(imageId, { tl: { col: 0, row: 4 }, ext: { width: dispW, height: dispH } });
  const headerRow = 5 + Math.ceil(dispH / 20) + 2; // default row height is 20 px

  const numeric = data.columns.map((_, c) => data.rows.length > 0 && data.rows.every((r) => typeof r[c] === 'number' || r[c] === ''));
  const decimals = data.columns.map((_, c) => numeric[c] && data.rows.some((r) => typeof r[c] === 'number' && !Number.isInteger(r[c])));
  const border = { style: 'thin' as const, color: { argb: 'FFD9DEE5' } };

  const head = ws.getRow(headerRow);
  data.columns.forEach((name, c) => {
    const cell = head.getCell(c + 1);
    cell.value = name;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } };
    cell.alignment = { vertical: 'middle', horizontal: numeric[c] ? 'right' : 'left' };
    cell.border = { top: border, bottom: border, left: border, right: border };
  });
  head.height = 22;

  data.rows.forEach((values, i) => {
    const row = ws.getRow(headerRow + 1 + i);
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      if (numeric[c]) cell.numFmt = decimals[c] ? '#,##0.00' : '#,##0';
      cell.alignment = { horizontal: numeric[c] ? 'right' : 'left' };
      cell.border = { top: border, bottom: border, left: border, right: border };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } };
    });
  });

  const firstData = headerRow + 1;
  const lastData = headerRow + data.rows.length;
  if (data.rows.length) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastData, column: lastCol } };
    const barCol = numeric.indexOf(true);
    if (barCol >= 0) {
      const letter = ws.getColumn(barCol + 1).letter;
      ws.addConditionalFormatting({
        ref: `${letter}${firstData}:${letter}${lastData}`,
        rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: brand } } as never],
      });
    }
  }

  data.columns.forEach((name, c) => {
    const longest = Math.max(String(name).length, ...data.rows.slice(0, 500).map((r) => String(r[c] ?? '').length));
    ws.getColumn(c + 1).width = Math.min(numeric[c] ? 16 : 70, Math.max(10, longest + 2));
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Saves a blob under a file name. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
