// English display names for the Japanese terms that come from the client's GA4 / Search Console files
// (segment names, column names, dimension values). Used only for display in English mode; the stored
// data and identifiers keep the original text. Search keywords and file names are never translated.

/** Safe to replace inside longer text (segment and column names). Longest first is applied. */
const PHRASES: Record<string, string> = {
  '通販（全体） オーガニックサーチ': 'E-commerce (total) – Organic Search',
  '通販（全体） ペイド系合算': 'E-commerce (total) – Paid (combined)',
  '通販（全体） ダイレクト': 'E-commerce (total) – Direct',
  '通販（全体）': 'E-commerce (total)',
  'オーガニックサーチ': 'Organic Search',
  'ペイド系合算': 'Paid (combined)',
  'ダイレクト': 'Direct',
  'トップページ': 'Top page',
  'カスタマイズ半額': 'Customization half-price',
  'e コマース購入数': 'Ecommerce purchases',
  'アクティブ ユーザー': 'Active users',
  'トランザクション': 'Transactions',
  'セッション': 'Sessions',
  'クリック数': 'Clicks',
  '表示回数': 'Impressions',
  '掲載順位': 'Position',
  '上位のクエリ': 'Top queries',
  '上位のページ': 'Top pages',
  '検索での見え方': 'Search appearance',
  'セグメント': 'Segment',
  '総計': 'Total',
};

/** Replaced only when they are the whole value (short words that could appear inside keywords). */
const EXACT: Record<string, string> = {
  '日付': 'Date',
  'デバイス': 'Device',
  '国': 'Country',
  'フィルタ': 'Filter',
  '値': 'Value',
  'モバイル': 'Mobile',
  'タブレット': 'Tablet',
  '検索タイプ': 'Search type',
  'ウェブ': 'Web',
  '過去 3 か月間': 'Last 3 months',
  '商品スニペット': 'Product snippets',
  '販売者のリスティング': 'Merchant listings',
  'レビュー スニペット': 'Review snippets',
  'ディスカッション フォーラム': 'Discussion forums',
  'ドミニカ': 'Dominica / Dominican Republic',
  // Search Console country spellings that differ from the ICU names.
  '米国': 'United States',
  '香港': 'Hong Kong',
  'バングラディッシュ': 'Bangladesh',
  'スイス連邦': 'Switzerland',
  'ミャンマー（ビルマ）': 'Myanmar (Burma)',
  'マカオ': 'Macao',
  'チェキア': 'Czechia',
  'ルクセンブルグ': 'Luxembourg',
  'グルジア': 'Georgia',
  'ミクロネシア': 'Micronesia',
  'グァテマラ': 'Guatemala',
  'マケドニア': 'North Macedonia',
  'フランス領ポリネシア': 'French Polynesia',
  'パレスチナ': 'Palestine',
  'コンゴ民主共和国 - キンシャサ': 'Congo - Kinshasa',
  '東チモール': 'Timor-Leste',
  'シェラレオネ': 'Sierra Leone',
  'セイシェル': 'Seychelles',
  'スワジランド': 'Eswatini',
  'マルチニーク': 'Martinique',
  '蘭領カリブ': 'Caribbean Netherlands',
  'セントクリストファー・ネイビス': 'St. Kitts & Nevis',
  'ベニン': 'Benin',
  'カボベルデ': 'Cape Verde',
  'コンゴ共和国 - ブラザビル': 'Congo - Brazzaville',
  'グアダループ': 'Guadeloupe',
  'フランス領ギニア': 'French Guiana',
  'スバールバル諸島とヤンマイエン島': 'Svalbard & Jan Mayen',
  'マイヨット島': 'Mayotte',
  'アメリカ領サモア': 'American Samoa',
  '中央アフリカ': 'Central African Republic',
  'セントビンセント・グレナディーン': 'St. Vincent & Grenadines',
  '南極大陸': 'Antarctica',
  '米領バージン諸島': 'U.S. Virgin Islands',
  '英領バージン諸島': 'British Virgin Islands',
  'セント・マーチン島': 'St. Martin',
  'サン・バルテルミー島': 'St. Barthélemy',
};

let countries: Map<string, string> | null = null;
/** Japanese country names → English, from the runtime's ICU data (Search Console 国 tab). */
function countryNames(): Map<string, string> {
  if (countries) return countries;
  countries = new Map();
  try {
    const ja = new Intl.DisplayNames(['ja'], { type: 'region' });
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 65;
    for (let i = 0; i < 26; i++)
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        const jaName = ja.of(code);
        const enName = en.of(code);
        if (jaName && enName && jaName !== code) countries.set(jaName, enName);
      }
  } catch {
    /* no ICU region names: countries stay as exported */
  }
  return countries;
}

const ORDERED = Object.keys(PHRASES).sort((a, b) => b.length - a.length);
const HAS_JAPANESE = /[぀-ヿ㐀-鿿＀-￯]/;

/**
 * English display text for client data. `whole` values (a cell, a label) also match exact terms and
 * country names; running text (a sentence, a report) only gets the phrase replacements.
 */
export function translateDataTerms(text: string, whole = true): string {
  if (!text || !HAS_JAPANESE.test(text)) return text;
  const t = text.trim();
  if (whole) {
    if (EXACT[t]) return EXACT[t]!;
    const country = countryNames().get(t);
    if (country) return country;
  }
  let out = text;
  for (const k of ORDERED) if (out.includes(k)) out = out.split(k).join(PHRASES[k]!);
  return out;
}
