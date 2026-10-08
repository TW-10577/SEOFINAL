// Evaluates the `formula` and `condition` expressions written in rules.yaml, e.g.
//   "((current_week_sessions - previous_week_sessions) / previous_week_sessions) * 100"
//   "organic_wow_change < 0 AND advertising_wow_change >= 0"
// Supported: numbers, variables, + - * /, unary minus, abs(), parentheses, < <= > >= == !=, AND, OR, NOT.
// A missing variable or a division by zero gives null ("unknown"), which propagates: a condition that
// depends on an unknown value is neither true nor false, so the rule is not evaluated rather than guessed.

export type Value = number | boolean | null;
export type Vars = Record<string, number | boolean | null | undefined>;

// Floating-point slack so that e.g. exactly −3.9% counts as "<= -3.9".
const EPS = 1e-9;

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'call'; fn: string; arg: Node }
  | { k: 'neg' | 'not'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

const TOKEN = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|<=|>=|==|!=|[-+*/()<>])/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  const s = src.trim();
  while (TOKEN.lastIndex < s.length) {
    const m = TOKEN.exec(s);
    if (!m) throw new Error(`rules.yaml expression: cannot read "${s.slice(TOKEN.lastIndex)}" in "${s}"`);
    out.push(m[1]!);
  }
  return out;
}

const cache = new Map<string, Node>();

export function parseExpr(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => {
    const x = toks[i++];
    if (t !== undefined && x !== t) throw new Error(`rules.yaml expression: expected "${t}" in "${src}"`);
    return x!;
  };
  const kw = (w: string) => peek()?.toUpperCase() === w;

  const or = (): Node => {
    let l = and();
    while (kw('OR')) (take(), (l = { k: 'bin', op: 'OR', l, r: and() }));
    return l;
  };
  const and = (): Node => {
    let l = not();
    while (kw('AND')) (take(), (l = { k: 'bin', op: 'AND', l, r: not() }));
    return l;
  };
  const not = (): Node => (kw('NOT') ? (take(), { k: 'not', e: not() }) : cmp());
  const cmp = (): Node => {
    const l = add();
    const op = peek();
    if (op && ['<', '<=', '>', '>=', '==', '!='].includes(op)) return (take(), { k: 'bin', op, l, r: add() });
    return l;
  };
  const add = (): Node => {
    let l = mul();
    while (peek() === '+' || peek() === '-') l = { k: 'bin', op: take(), l, r: mul() };
    return l;
  };
  const mul = (): Node => {
    let l = unary();
    while (peek() === '*' || peek() === '/') l = { k: 'bin', op: take(), l, r: unary() };
    return l;
  };
  const unary = (): Node => (peek() === '-' ? (take(), { k: 'neg', e: unary() }) : primary());
  const primary = (): Node => {
    const t = take();
    if (t === undefined) throw new Error(`rules.yaml expression: unexpected end of "${src}"`);
    if (t === '(') {
      const e = or();
      take(')');
      return e;
    }
    if (/^\d/.test(t)) return { k: 'num', v: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        take('(');
        const arg = or();
        take(')');
        if (t.toLowerCase() !== 'abs') throw new Error(`rules.yaml expression: unknown function ${t}() in "${src}"`);
        return { k: 'call', fn: 'abs', arg };
      }
      return { k: 'var', name: t };
    }
    throw new Error(`rules.yaml expression: unexpected "${t}" in "${src}"`);
  };

  const node = or();
  if (i < toks.length) throw new Error(`rules.yaml expression: unexpected "${toks[i]}" in "${src}"`);
  cache.set(src, node);
  return node;
}

const num = (v: Value): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function evaluate(n: Node, vars: Vars): Value {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var':
      return vars[n.name] ?? null;
    case 'call': {
      const v = num(evaluate(n.arg, vars));
      return v === null ? null : Math.abs(v);
    }
    case 'neg': {
      const v = num(evaluate(n.e, vars));
      return v === null ? null : -v;
    }
    case 'not': {
      const v = evaluate(n.e, vars);
      return v === null ? null : !v;
    }
    case 'bin': {
      if (n.op === 'AND' || n.op === 'OR') {
        const l = evaluate(n.l, vars);
        const r = evaluate(n.r, vars);
        // Three-valued logic: a known false (AND) / true (OR) decides regardless of an unknown side.
        if (n.op === 'AND') return l === false || r === false ? false : l === null || r === null ? null : true;
        return l === true || r === true ? true : l === null || r === null ? null : false;
      }
      const l = num(evaluate(n.l, vars));
      const r = num(evaluate(n.r, vars));
      if (l === null || r === null) return null;
      switch (n.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? null : l / r;
        case '<': return l < r - EPS;
        case '<=': return l <= r + EPS;
        case '>': return l > r + EPS;
        case '>=': return l >= r - EPS;
        case '==': return Math.abs(l - r) <= EPS;
        case '!=': return Math.abs(l - r) > EPS;
      }
    }
  }
  return null;
}

/** A formula's value; null when an input is missing or a division by zero occurs. */
export function evalNumber(src: string, vars: Vars): number | null {
  return num(evaluate(parseExpr(src), vars));
}

/** A condition's truth; null when it depends on an unknown value. */
export function evalCondition(src: string, vars: Vars): boolean | null {
  const v = evaluate(parseExpr(src), vars);
  return typeof v === 'boolean' ? v : null;
}

/** Variable names an expression reads. */
export function variablesOf(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'var') out.add(n.name);
    else if (n.k === 'call') walk(n.arg);
    else if (n.k === 'neg' || n.k === 'not') walk(n.e);
    else if (n.k === 'bin') (walk(n.l), walk(n.r));
  };
  walk(parseExpr(src));
  return [...out];
}

/** rules.yaml folded text ("> ...") → one line. */
export const oneLine = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
