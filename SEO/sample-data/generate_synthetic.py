"""Generate SYNTHETIC GSC / GA4 exports for development and demos.

Baselines come from the real dospara exports in ../ (ページ.csv, クエリ.csv, the GSC date chart and
download (43).csv); daily values, the long tail of queries and every anomaly scenario are invented.
Deterministic: the same seed always produces the same files.  Run:  python3 generate_synthetic.py
"""

import csv
import datetime as dt
import random
from pathlib import Path

SEED = 20260929
START = dt.date(2026, 9, 16)
DAYS = 14
WEEK2 = START + dt.timedelta(days=7)  # 2026-09-23: scenarios apply from here
PAGE_DROPOUT_DAY = dt.date(2026, 9, 25)

HERE = Path(__file__).parent
SEO = HERE.parent
REAL_GSC = SEO / 'https___www.dospara.co.jp_-Performance-on-Search-2026-09-18'
OUT = HERE / 'synthetic'
REAL_DAYS = 92  # length of the real GSC export the totals cover
PAGE_COVERAGE = 0.941  # share of site clicks the real ページ.csv covers

# Weekday factors measured on the real GSC date chart (Mon=0).
WEEKDAY = {0: 1.018, 1: 1.022, 2: 1.019, 3: 1.008, 4: 0.977, 5: 0.949, 6: 1.004}

# --- scenarios (week 2 = 2026-09-23..29 vs week 1 = 2026-09-16..22) -------------------------
SITE_CTR_FACTOR = 0.88  # SERP layout change: CTR falls on every page while position holds
PAGE_POSITION_DROP = {'https://www.dospara.co.jp/gamepc': 1.9}  # ranking loss (positions)
PAGE_DROPOUT = 'https://www.dospara.co.jp/5shopping/shp_vga_def_parts.html'  # page 404s from 09-25
QUERY_POSITION_DROP = {'ゲーミングpc': 2.3}
QUERY_DROPOUT = 'vspo pc'  # near the top-1000 cut-off; vanishes in week 2
GA4_WEEK2 = {'organic': 0.89, 'direct': 0.99, 'paid': 1.01, 'other': 1.0}
GA4_CVR_WEEK2 = 0.955  # conversion rate dips ~4.5% relative (≈ −0.04 pt at the real ~0.95% CVR)


def read_rows(path):
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.reader(f))[1:]


def days():
    return [START + dt.timedelta(days=i) for i in range(DAYS)]


def ctr_for_position(pos):
    # Rough organic CTR curve: falls as position worsens. Only used to scale scenario changes.
    return 1 / (1 + 0.35 * max(pos, 1) ** 1.2)


def daily_rows(rng, base_clicks, base_impr, base_pos, key, pos_drop, dropout_day=None):
    rows = []
    for d in days():
        w2 = d >= WEEK2
        if dropout_day and d >= dropout_day:
            continue
        pos = base_pos + rng.gauss(0, 0.05 * base_pos) + (pos_drop if w2 else 0)
        pos = max(1.0, pos)
        impr = base_impr * WEEKDAY[d.weekday()] * rng.uniform(0.92, 1.08)
        if w2 and pos_drop:
            impr *= 0.9  # fewer impressions at a worse position
        ctr = (base_clicks / base_impr) if base_impr else 0
        ctr *= ctr_for_position(pos) / ctr_for_position(base_pos)
        if w2:
            ctr *= SITE_CTR_FACTOR
        clicks = round(impr * ctr * rng.uniform(0.95, 1.05))
        impr = max(round(impr), clicks)
        if impr == 0:
            continue
        rows.append([d.isoformat(), key, clicks, impr, round(pos, 2)])
    return rows


def write_gsc(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            clicks, impr = r[-3], r[-2]
            w.writerow([*r[:-3], clicks, impr, f'{clicks / impr * 100:.2f}%', r[-1]])


LONG_TAIL_TERMS = (
    ['ドスパラ', 'ガレリア', 'raytrek', 'THIRDWAVE', 'ドスパラ 通販', ''],
    ['ゲーミングpc', 'ノートpc', 'グラボ', 'rtx 5070', 'rtx 5060 ti', 'rtx 5080', 'ryzen 7 9800x3d', 'core ultra 7',
     'メモリ 32gb', 'ssd 2tb', 'モニター 27インチ', 'ゲーミングマウス', 'キーボード', '電源 850w', 'cpuクーラー', 'pcケース'],
    ['', 'おすすめ', '価格', 'セール', '口コミ', '比較', '中古', '在庫', '安い', '2026', '評判', '最安', '納期', 'bto'],
)


def long_tail_queries(rng, existing, n):
    combos = sorted({' '.join(t for t in (a, b, c) if t) for a in LONG_TAIL_TERMS[0] for b in LONG_TAIL_TERMS[1] for c in LONG_TAIL_TERMS[2]})
    combos = [q for q in combos if q not in existing]
    rng.shuffle(combos)
    out = []
    for i, q in enumerate(combos[:n]):
        clicks_per_day = 2.2 * (i + 1) ** -0.35  # below the real file's smallest query (212 / 92 days ≈ 2.3 a day)
        out.append((q, clicks_per_day * REAL_DAYS, clicks_per_day * REAL_DAYS / 0.03, rng.uniform(6, 25)))
    return out


def main():
    rng = random.Random(SEED)
    OUT.mkdir(exist_ok=True)
    stamp = f'{START:%Y%m%d}-{(START + dt.timedelta(days=DAYS - 1)):%Y%m%d}'

    # Pages: every real page, daily, plus the scenarios.
    page_rows = []
    for url, clicks, impr, _ctr, pos in read_rows(REAL_GSC / 'ページ.csv'):
        page_rows += daily_rows(rng, int(clicks) / REAL_DAYS, int(impr) / REAL_DAYS, float(pos), url,
                                PAGE_POSITION_DROP.get(url, 0), PAGE_DROPOUT_DAY if url == PAGE_DROPOUT else None)
    write_gsc(OUT / f'SYNTHETIC_gsc_pages_daily_{stamp}.csv', ['日付', 'ページ', 'クリック数', '表示回数', 'CTR', '掲載順位'], page_rows)

    # Queries: the real top 1000 plus an invented long tail below the old cut-off.
    real_q = read_rows(REAL_GSC / 'クエリ.csv')
    queries = [(q, int(c), int(i), float(p)) for q, c, i, _ctr, p in real_q]
    queries += long_tail_queries(rng, {q for q, *_ in queries}, 1500)
    query_rows = []
    for q, clicks, impr, pos in queries:
        query_rows += daily_rows(rng, clicks / REAL_DAYS, impr / REAL_DAYS, pos, q,
                                 QUERY_POSITION_DROP.get(q, 0), WEEK2 if q == QUERY_DROPOUT else None)
    write_gsc(OUT / f'SYNTHETIC_gsc_queries_daily_{stamp}.csv', ['日付', 'クエリ', 'クリック数', '表示回数', 'CTR', '掲載順位'], query_rows)

    # Site-level date chart, derived from the pages so the levels agree.
    site = {}
    for date, _url, clicks, impr, pos in page_rows:
        s = site.setdefault(date, [0, 0, 0.0])
        s[0] += clicks
        s[1] += impr
        s[2] += pos * impr
    # Page impressions overlap (one search can show several pages), so scale them with the real site/page ratio.
    real_site_impr = sum(int(r[2]) for r in read_rows(REAL_GSC / '平均読み込み時間のチャート.csv'))
    real_page_impr = sum(int(r[2]) for r in read_rows(REAL_GSC / 'ページ.csv'))
    impr_ratio = real_site_impr / real_page_impr
    site_rows = [[d, round(c / PAGE_COVERAGE), round(i * impr_ratio), round(pw / i, 2)] for d, (c, i, pw) in sorted(site.items())]
    with open(OUT / f'SYNTHETIC_gsc_date_chart_{stamp}.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'])
        for d, c, i, p in site_rows:
            w.writerow([d, c, i, f'{c / i * 100:.2f}%', p])

    # GA4 daily by channel, same layout as download (43).csv, baselined on its daily averages.
    ga4_real = [r for r in csv.reader(open(SEO / 'download (43).csv', encoding='utf-8-sig')) if r and r[0].isdigit()]
    avg = [sum(int(r[i]) for r in ga4_real) / len(ga4_real) for i in range(1, 9)]
    base = {'total': avg[0:2], 'organic': avg[2:4], 'direct': avg[4:6], 'paid': avg[6:8]}
    base['other'] = [base['total'][k] - base['organic'][k] - base['direct'][k] - base['paid'][k] for k in (0, 1)]
    ga4_rows = []
    for d in days():
        w2 = d >= WEEK2
        seg = {}
        for name in ('organic', 'direct', 'paid', 'other'):
            s = base[name][0] * WEEKDAY[d.weekday()] * rng.uniform(0.97, 1.03) * (GA4_WEEK2[name] if w2 else 1)
            p = base[name][1] / base[name][0] * s * rng.uniform(0.95, 1.05) * (GA4_CVR_WEEK2 if w2 else 1)
            seg[name] = (round(s), round(p))
        total = (sum(v[0] for v in seg.values()), sum(v[1] for v in seg.values()))
        ga4_rows.append([d.strftime('%Y%m%d'), *total, *seg['organic'], *seg['direct'], *seg['paid']])
    sums = [sum(r[i] for r in ga4_rows) for i in range(1, 9)]
    with open(OUT / f'SYNTHETIC_ga4_daily_{stamp}.csv', 'w', encoding='utf-8', newline='') as f:
        f.write(f'# ----------------------------------------\n# SYNTHETIC DATA - generated by sample-data/generate_synthetic.py, not a real GA4 export\n'
                f'# https://www.dospara.co.jp - GA4\n# {stamp}\n# ----------------------------------------\n\n')
        w = csv.writer(f)
        segs = ['通販（全体）', '通販（全体） オーガニックサーチ', '通販（全体） ダイレクト', '通販（全体） ペイド系合算']
        w.writerow(['セグメント', *[s for s in segs for _ in (0, 1)]])
        w.writerow(['日付', *['セッション', 'e コマース購入数'] * 4])
        w.writerow(['', *sums, '総計'])
        w.writerows(ga4_rows)

    extend_real_ga4(rng)

    for p in sorted(OUT.glob('SYNTHETIC_*.csv')):
        print(f'{p.name}: {sum(1 for _ in open(p, encoding="utf-8"))} lines')


def extend_real_ga4(rng):
    """Prefix the real 6-day GA4 export (09-10..15) with 8 invented days (09-02..09-09) so it covers 14 days.

    The invented days follow the real week's level, weekday pattern and channel mix with no trend, so the
    week-over-week result says nothing the real data does not.
    """
    lines = open(SEO / 'download (43).csv', encoding='utf-8-sig').read().splitlines()
    rows = [r for r in csv.reader(lines) if r and r[0].isdigit()]
    real = {dt.datetime.strptime(r[0], '%Y%m%d').date(): [int(v) for v in r[1:9]] for r in rows}
    first = min(real)
    # Per-column level with the weekday effect removed, averaged over the real days.
    level = [sum(v[i] / WEEKDAY[d.weekday()] for d, v in real.items()) / len(real) for i in range(8)]
    fake = {}
    for n in range(1, 9):
        d = first - dt.timedelta(days=n)
        seg = [round(level[i] * WEEKDAY[d.weekday()] * rng.uniform(0.97, 1.03)) for i in range(2, 8)]
        other_sessions = round((level[0] - level[2] - level[4] - level[6]) * WEEKDAY[d.weekday()] * rng.uniform(0.97, 1.03))
        other_purchases = round((level[1] - level[3] - level[5] - level[7]) * WEEKDAY[d.weekday()] * rng.uniform(0.95, 1.05))
        total = [seg[0] + seg[2] + seg[4] + other_sessions, seg[1] + seg[3] + seg[5] + other_purchases]
        fake[d] = total + seg
    allrows = {**fake, **real}
    sums = [sum(v[i] for v in allrows.values()) for i in range(8)]
    start, end = min(allrows), max(allrows)

    header = [l for l in lines if l.startswith('#') or l.startswith('セグメント') or l.startswith('日付')]
    out = OUT / f'SYNTHETIC_download (43)_2weeks_{start:%Y%m%d}-{end:%Y%m%d}.csv'
    with open(out, 'w', encoding='utf-8', newline='') as f:
        f.write('# ----------------------------------------\n')
        f.write('# PARTLY SYNTHETIC - made by sample-data/generate_synthetic.py from download (43).csv\n')
        f.write(f'# REAL rows: {first:%Y%m%d}-{max(real):%Y%m%d}   INVENTED rows: {start:%Y%m%d}-{(first - dt.timedelta(days=1)):%Y%m%d}\n')
        f.write(f'# {start:%Y%m%d}-{end:%Y%m%d}\n')
        f.write('# ----------------------------------------\n\n')
        f.write('\n'.join(l for l in header if not l.startswith('#')) + '\n')
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['', *sums, '総計'])
        for d in sorted(allrows):
            w.writerow([d.strftime('%Y%m%d'), *allrows[d]])


if __name__ == '__main__':
    main()
