// Loads the LOGOS SEO ontology (LOGOS_SEO_Ontology_Standalone_Final) and exposes what the system runs on:
// lifecycles (state changes the SEO team may make), vocabularies and labels, and the judgment-condition contract.
// The API refuses to start when the ontology is missing something the system depends on.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import type { LText } from './i18n.ts';

const here = dirname(new URL(import.meta.url).pathname);
export const DEFAULT_ONTOLOGY_DIR = resolve(here, '../../LOGOS_SEO_Ontology_Standalone_Final/ontology');

type Raw = Record<string, any>;

export interface Definition {
  kind: string;
  id: string;
  apiName: string;
  displayName: LText;
  description: string;
  version: string;
  annotations: Record<string, string>;
  file: string;
  spec: Raw;
}

export interface VocabularyValue {
  code: string;
  apiName: string;
  label: LText;
}

export interface Transition {
  id: string;
  from: string; // vocabulary apiName, e.g. Detected
  to: string;
  actionId: string;
  actionApiName: string;
  actionLabel: LText;
}

export interface Lifecycle {
  objectId: string;
  objectApiName: string;
  stateProperty: string;
  states: string[]; // apiNames in declared order
  initial: string;
  terminal: string[];
  transitions: Transition[];
}

export interface Ontology {
  dir: string;
  packageId: string;
  version: string;
  definitions: Map<string, Definition>;
  vocabularies: Map<string, VocabularyValue[]>; // by value-type id
  lifecycles: Map<string, Lifecycle>; // by object apiName
}

const label = (v: Raw | undefined): LText => ({ en: v?.en ?? '', ja: v?.ja ?? v?.en ?? '' });

function listYaml(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listYaml(p));
    else if (name.endsWith('.logos.yaml')) out.push(p);
  }
  return out;
}

export class OntologyError extends Error {}

export function loadOntology(dir = process.env.SEO_ONTOLOGY_DIR ?? DEFAULT_ONTOLOGY_DIR): Ontology {
  let files: string[];
  try {
    files = listYaml(dir);
  } catch {
    throw new OntologyError(`Ontology directory not found: ${dir}`);
  }
  const definitions = new Map<string, Definition>();
  for (const file of files) {
    let doc: Raw;
    try {
      doc = parse(readFileSync(file, 'utf8')) as Raw;
    } catch (e) {
      throw new OntologyError(`${relative(dir, file)}: not valid YAML — ${(e as Error).message.split('\n')[0]}`);
    }
    const m = doc?.metadata;
    if (!doc?.kind || !m?.id) throw new OntologyError(`${relative(dir, file)}: missing kind or metadata.id`);
    if (definitions.has(m.id)) throw new OntologyError(`Duplicate definition id ${m.id}`);
    definitions.set(m.id, {
      kind: doc.kind,
      id: m.id,
      apiName: m.apiName,
      displayName: label(m.displayName),
      description: m.description?.en ?? '',
      version: String(m.version ?? ''),
      annotations: m.annotations ?? {},
      file: relative(dir, file),
      spec: doc.spec ?? {},
    });
  }
  const pkg = [...definitions.values()].find((d) => d.kind === 'OntologyPackage' && d.spec.packageKind === 'domain' && d.spec.namespace === 'seo');
  if (!pkg) throw new OntologyError('No SEO domain package (logos.seo.package.*) found.');

  const vocabularies = new Map<string, VocabularyValue[]>();
  for (const d of definitions.values())
    if (d.kind === 'ValueType' && d.spec.valueKind === 'vocabulary')
      vocabularies.set(d.id, (d.spec.vocabularyValues ?? []).map((v: Raw) => ({ code: v.code, apiName: v.apiName, label: label(v.displayName) })));

  const lifecycles = new Map<string, Lifecycle>();
  for (const d of definitions.values()) {
    const lc = d.kind === 'ObjectType' ? d.spec.lifecycle : undefined;
    if (!lc) continue;
    const propId = String(lc.statePropertyRef).replace('#property/', '');
    const prop = (d.spec.properties ?? []).find((p: Raw) => p.memberId === propId);
    const vocab: VocabularyValue[] | undefined = prop ? vocabularies.get(prop.valueTypeRef) : undefined;
    if (!vocab) throw new OntologyError(`${d.id}: lifecycle state property ${propId} is not a vocabulary.`);
    const values = vocab;
    const apiOf = (code: string) => {
      const v = values.find((x) => x.code === code);
      if (!v) throw new OntologyError(`${d.id}: lifecycle state ${code} is not in ${prop.valueTypeRef}.`);
      return v.apiName;
    };
    const states = (lc.states as Raw[]).map((s) => apiOf(s.code));
    const initial = (lc.states as Raw[]).filter((s) => s.initial);
    if (initial.length !== 1) throw new OntologyError(`${d.id}: lifecycle must have exactly one initial state.`);
    const transitions = ((lc.transitions ?? []) as Raw[]).map((t) => {
      const action = definitions.get(t.actionRef);
      if (!action || action.kind !== 'ActionType') throw new OntologyError(`${d.id}: transition ${t.transitionId} references missing action ${t.actionRef}.`);
      const bound = (action.spec.effects ?? []).some((e: Raw) => e.effectKind === 'lifecycle_transition' && e.lifecycleTransitionRef === `#transition/${t.transitionId}`);
      if (!bound) throw new OntologyError(`${t.actionRef}: has no lifecycle_transition effect for #transition/${t.transitionId} (LIF-07).`);
      return { id: t.transitionId, from: apiOf(t.fromState), to: apiOf(t.toState), actionId: action.id, actionApiName: action.apiName, actionLabel: action.displayName };
    });
    lifecycles.set(d.apiName, {
      objectId: d.id,
      objectApiName: d.apiName,
      stateProperty: propId,
      states,
      initial: apiOf(initial[0]!.code),
      terminal: (lc.states as Raw[]).filter((s) => s.terminal).map((s) => apiOf(s.code)),
      transitions,
    });
  }

  const ont: Ontology = { dir, packageId: pkg.id, version: pkg.version, definitions, vocabularies, lifecycles };
  requireContract(ont);
  return ont;
}

// ---------- What the SEO system depends on ----------

/** Ontology objects whose lifecycle the system enforces, keyed by the entity name used in the API. */
export const GOVERNED = { anomaly: 'SEOAnomaly', cause: 'CauseHypothesis', countermeasure: 'Countermeasure' } as const;
export type GovernedEntity = keyof typeof GOVERNED;

export const VT = {
  anomalyStatus: 'logos.seo.value.anomaly-status',
  countermeasureStatus: 'logos.seo.value.countermeasure-status',
  reviewStatus: 'logos.seo.value.human-review-status',
  confidence: 'logos.seo.value.confidence-level',
  significance: 'logos.seo.value.significance-result',
  thresholdUnit: 'logos.seo.value.threshold-unit',
  direction: 'logos.seo.value.change-direction',
  conditionType: 'logos.seo.value.condition-type',
  subjectType: 'logos.seo.value.analysis-unit-type',
  dataSource: 'logos.seo.value.data-source',
} as const;

const REQUIRED_OBJECTS = ['Site', 'SearchQuery', 'Page', 'QueryClassification', 'TrafficSource', 'AnalysisPeriod', 'SEOData', 'JudgmentCondition', 'SEOAnomaly', 'CauseHypothesis', 'Countermeasure'];

function requireContract(o: Ontology) {
  const objects = new Set([...o.definitions.values()].filter((d) => d.kind === 'ObjectType').map((d) => d.apiName));
  const missing = REQUIRED_OBJECTS.filter((n) => !objects.has(n));
  if (missing.length) throw new OntologyError(`Ontology is missing objects the system uses: ${missing.join(', ')}`);
  for (const name of Object.values(GOVERNED)) if (!o.lifecycles.has(name)) throw new OntologyError(`Ontology object ${name} has no lifecycle.`);
  for (const id of Object.values(VT)) if (!o.vocabularies.has(id)) throw new OntologyError(`Ontology is missing vocabulary ${id}.`);
  const expectInitial: Record<string, string> = { SEOAnomaly: 'Detected', CauseHypothesis: 'NotReviewed', Countermeasure: 'Proposed' };
  for (const [obj, state] of Object.entries(expectInitial))
    if (o.lifecycles.get(obj)!.initial !== state)
      throw new OntologyError(`${obj}: the system creates records in ${state}, but the ontology's initial state is ${o.lifecycles.get(obj)!.initial}.`);
}

export function lifecycleOf(o: Ontology, entity: GovernedEntity): Lifecycle {
  return o.lifecycles.get(GOVERNED[entity])!;
}

/** Transitions available from `state` for the entity, as declared in the ontology. */
export function nextTransitions(o: Ontology, entity: GovernedEntity, state: string): Transition[] {
  return lifecycleOf(o, entity).transitions.filter((t) => t.from === state);
}

export function vocabulary(o: Ontology, valueTypeId: string): VocabularyValue[] {
  return o.vocabularies.get(valueTypeId) ?? [];
}

export function vocabCodes(o: Ontology, valueTypeId: string): string[] {
  return vocabulary(o, valueTypeId).map((v) => v.code);
}

// ---------- API view ----------

export interface OntologySummary {
  packageId: string;
  version: string;
  directory: string;
  counts: Record<string, number>;
  objects: { id: string; apiName: string; label: LText; description: string; lifecycle: boolean }[];
  lifecycles: Record<GovernedEntity, Lifecycle>;
  vocabularies: Record<string, VocabularyValue[]>;
  relations: { id: string; apiName: string; label: LText; from: string; to: string; cardinality: string }[];
  actions: { id: string; apiName: string; label: LText; performedBy: string; target: string }[];
}

export function summarize(o: Ontology): OntologySummary {
  const defs = [...o.definitions.values()];
  const counts: Record<string, number> = {};
  for (const d of defs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  const apiNameOf = (id: string) => o.definitions.get(id)?.apiName ?? id;
  return {
    packageId: o.packageId,
    version: o.version,
    directory: o.dir,
    counts,
    objects: defs.filter((d) => d.kind === 'ObjectType').map((d) => ({ id: d.id, apiName: d.apiName, label: d.displayName, description: d.description, lifecycle: !!d.spec.lifecycle })),
    lifecycles: { anomaly: lifecycleOf(o, 'anomaly'), cause: lifecycleOf(o, 'cause'), countermeasure: lifecycleOf(o, 'countermeasure') },
    vocabularies: Object.fromEntries(Object.entries(VT).map(([k, id]) => [k, vocabulary(o, id)])),
    relations: defs
      .filter((d) => d.kind === 'RelationType')
      .map((d) => {
        const fwd = d.spec.accessors?.[0] ?? {};
        return { id: d.id, apiName: d.apiName, label: d.displayName, from: apiNameOf(fwd.fromTypeRef), to: apiNameOf(fwd.returnsTypeRef), cardinality: `${d.spec.accessors?.[1]?.cardinality ?? '?'} → ${fwd.cardinality ?? '?'}` };
      }),
    actions: defs
      .filter((d) => d.kind === 'ActionType')
      .map((d) => ({ id: d.id, apiName: d.apiName, label: d.displayName, performedBy: d.annotations['logos.ext/performed-by'] ?? '', target: apiNameOf(d.spec.target?.targetTypeRef) })),
  };
}

// ---------- Mappings between system values and ontology vocabularies ----------

/** Measurement status shown in the UI ↔ SignificanceResult. */
export const STATUS_TO_SIGNIFICANCE = { NG: 'SIGNIFICANT', OK: 'NOT_SIGNIFICANT', NOT_EVALUABLE: 'NOT_EVALUABLE' } as const;

/** Analysis-unit subject types stored by the engine ↔ AnalysisUnitType. */
export const SUBJECT_TO_UNIT = { site: 'SITE', traffic_source: 'TRAFFIC_SOURCE', query: 'SEARCH_QUERY', page: 'PAGE' } as const;

/** rules.yaml threshold_unit ↔ ThresholdUnit. */
export const UNIT_TO_CODE = { percent: 'PERCENT', percentage_points: 'PERCENTAGE_POINTS', unresolved: 'UNRESOLVED' } as const;

export interface ConditionContract {
  id: string;
  thresholdUnit: string;
  direction: string;
  conditionType: string;
}

/** Checks each configured judgment condition against the JudgmentCondition vocabularies. */
export function checkJudgmentConditions(o: Ontology, conditions: ConditionContract[]): string[] {
  const problems: string[] = [];
  const allowed = (vt: string) => new Set(vocabCodes(o, vt));
  for (const c of conditions) {
    const unit = UNIT_TO_CODE[c.thresholdUnit as keyof typeof UNIT_TO_CODE];
    if (!unit || !allowed(VT.thresholdUnit).has(unit)) problems.push(`${c.id}: threshold_unit "${c.thresholdUnit}" is not a ThresholdUnit (${[...allowed(VT.thresholdUnit)].join(', ')}).`);
    if (!allowed(VT.direction).has(c.direction.toUpperCase())) problems.push(`${c.id}: direction "${c.direction}" is not a ChangeDirection (${[...allowed(VT.direction)].join(', ')}).`);
    if (!allowed(VT.conditionType).has(c.conditionType.toUpperCase())) problems.push(`${c.id}: condition_type "${c.conditionType}" is not a ConditionType (${[...allowed(VT.conditionType)].join(', ')}).`);
  }
  return problems;
}

/** Everything checked before the API starts. Returns problems; empty means the system and the ontology agree. */
export function startupProblems(o: Ontology, rules: ConditionContract[]): string[] {
  return checkJudgmentConditions(o, rules);
}
