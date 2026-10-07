import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { FlatBand, JudgmentCondition } from './types.ts'

export class OntologyError extends Error {}

// Value types owned by other LOGOS packages; the SEO folder only references them.
const EXTERNAL_PRIMITIVES: Record<string, 'string' | 'number' | 'boolean' | 'date'> = {
  'logos.shared-core.value.short-text': 'string',
  'logos.shared-core.value.long-text': 'string',
  'logos.shared-core.value.number': 'number',
  'logos.shared-core.value.boolean': 'boolean',
  'logos.shared-core.value.date': 'date',
  'logos.retail-ec-common.value.subject-id': 'string',
  'logos.retail-ec-common.value.record-id': 'string',
}

export interface FieldDef {
  apiName: string
  valueTypeRef: string
  required: boolean
  nullable: boolean
}

export interface EnumValue {
  value: string
  displayName: { en?: string; ja?: string }
}

type ValueTypeDef =
  | { id: string; kind: 'enum'; values: EnumValue[]; initial?: string; transitions?: Record<string, string[]> }
  | { id: string; kind: 'number'; min?: number; max?: number }
  | { id: string; kind: 'struct'; fields: FieldDef[] }

export interface ObjectDef {
  id: string
  apiName: string
  file: string
  properties: FieldDef[]
}

export const JUDGMENT_CONDITION_TYPE = 'logos.seo.object.judgment-condition'

function readYamlDir(dir: string): { file: string; doc: any }[] {
  if (!existsSync(dir)) throw new OntologyError(`Ontology folder not found: ${dir}`)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.logos.yaml'))
    .sort()
    .map((f) => {
      try {
        return { file: join(dir, f), doc: parse(readFileSync(join(dir, f), 'utf8')) }
      } catch (e) {
        throw new OntologyError(`${f}: invalid YAML (${(e as Error).message})`)
      }
    })
}

const toField = (f: any): FieldDef => ({
  apiName: String(f.apiName),
  valueTypeRef: String(f.valueTypeRef),
  required: f.required !== false,
  nullable: f.nullable === true,
})

export class Ontology {
  constructor(
    readonly dir: string,
    readonly valueTypes: Map<string, ValueTypeDef>,
    readonly objects: Map<string, ObjectDef>,
    readonly conditions: JudgmentCondition[],
    readonly flatBands: Record<string, FlatBand>,
    readonly relations: string[] = [],
    readonly functions: string[] = [],
  ) {}

  // Lifecycle (design §8) declared on the enum: which statuses may follow the current one.
  lifecycle(id: string): { initial: string; transitions: Record<string, string[]> } {
    const vt = this.valueTypes.get(id)
    if (vt?.kind !== 'enum' || !vt.initial || !vt.transitions) throw new OntologyError(`${id} has no lifecycle (initialValue and transitions)`)
    return { initial: vt.initial, transitions: vt.transitions }
  }

  enumValues(id: string): string[] {
    const vt = this.valueTypes.get(id)
    if (vt?.kind !== 'enum') throw new OntologyError(`${id} is not an enumerated value type in ${this.dir}`)
    return vt.values.map((v) => v.value)
  }

  // Fails fast when the API code and the ontology disagree on an enum.
  assertEnumMatches(id: string, codeValues: readonly string[]): void {
    const yaml = this.enumValues(id)
    const missing = codeValues.filter((v) => !yaml.includes(v))
    const extra = yaml.filter((v) => !codeValues.includes(v))
    if (missing.length || extra.length) {
      throw new OntologyError(
        `${id} does not match the API code.` +
          (missing.length ? ` Missing in YAML: ${missing.join(', ')}.` : '') +
          (extra.length ? ` Not handled by code: ${extra.join(', ')}.` : ''),
      )
    }
  }

  validateValue(ref: string, value: unknown, path: string): string[] {
    const primitive = EXTERNAL_PRIMITIVES[ref]
    if (primitive) {
      if (primitive === 'number') return typeof value === 'number' && Number.isFinite(value) ? [] : [`${path}: expected a number`]
      if (primitive === 'boolean') return typeof value === 'boolean' ? [] : [`${path}: expected true/false`]
      if (primitive === 'date') {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? [] : [`${path}: expected a YYYY-MM-DD date`]
      }
      return typeof value === 'string' ? [] : [`${path}: expected text`]
    }
    const vt = this.valueTypes.get(ref)
    if (!vt) return [`${path}: unknown value type ${ref}`]
    if (vt.kind === 'enum') {
      const allowed = vt.values.map((v) => v.value)
      return allowed.includes(value as string) ? [] : [`${path}: "${String(value)}" is not one of ${allowed.join(', ')}`]
    }
    if (vt.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: expected a number`]
      if (vt.min !== undefined && value < vt.min) return [`${path}: ${value} is below the minimum ${vt.min}`]
      if (vt.max !== undefined && value > vt.max) return [`${path}: ${value} is above the maximum ${vt.max}`]
      return []
    }
    return this.validateFields(vt.fields, value, path)
  }

  validateFields(fields: FieldDef[], value: unknown, path: string): string[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected an object`]
    const record = value as Record<string, unknown>
    const errors: string[] = []
    for (const f of fields) {
      const v = record[f.apiName]
      const p = `${path}.${f.apiName}`
      if (v === undefined) {
        if (f.required) errors.push(`${p}: required`)
      } else if (v === null) {
        if (!f.nullable) errors.push(`${p}: must not be null`)
      } else {
        errors.push(...this.validateValue(f.valueTypeRef, v, p))
      }
    }
    const known = new Set(fields.map((f) => f.apiName))
    for (const k of Object.keys(record)) if (!known.has(k)) errors.push(`${path}.${k}: not defined in the ontology`)
    return errors
  }

  assertObject(objectId: string, value: unknown): void {
    const def = this.objects.get(objectId)
    if (!def) throw new OntologyError(`Object type ${objectId} not found in ${this.dir}`)
    const errors = this.validateFields(def.properties, value, def.apiName)
    if (errors.length) throw new OntologyError(`Value does not conform to ${objectId}: ${errors.join('; ')}`)
  }

  summary() {
    return {
      dir: this.dir,
      objects: [...this.objects.values()].map(({ id, apiName, properties }) => ({ id, apiName, properties })),
      relations: this.relations,
      functions: this.functions,
      enums: Object.fromEntries(
        [...this.valueTypes.values()].flatMap((vt) => (vt.kind === 'enum' ? [[vt.id, vt.values] as const] : [])),
      ),
      conditions: this.conditions,
      flatBands: this.flatBands,
      lifecycles: Object.fromEntries(
        [...this.valueTypes.values()].flatMap((vt) =>
          vt.kind === 'enum' && vt.transitions ? [[vt.id, { initial: vt.initial, transitions: vt.transitions }] as const] : [],
        ),
      ),
    }
  }
}

export function loadOntology(dir: string): Ontology {
  const valueTypes = new Map<string, ValueTypeDef>()
  for (const { file, doc } of readYamlDir(join(dir, 'value-types'))) {
    if (doc?.kind !== 'ValueType') continue
    const id = doc.metadata?.id
    const spec = doc.spec ?? {}
    if (!id) throw new OntologyError(`${file}: metadata.id is missing`)
    if (spec.valueKind === 'enumerated_text') {
      const values = (spec.enumeratedValues ?? []).map((v: any) => ({ value: String(v.value), displayName: v.displayName ?? {} }))
      if (!values.length) throw new OntologyError(`${file}: enumeratedValues is empty`)
      const names = values.map((v: EnumValue) => v.value)
      const transitions = spec.transitions as Record<string, string[]> | undefined
      if (transitions) {
        const bad = [
          ...(spec.initialValue && !names.includes(spec.initialValue) ? [`initialValue ${spec.initialValue}`] : []),
          ...Object.entries(transitions).flatMap(([from, tos]) => [from, ...(tos ?? [])].filter((v) => !names.includes(v))),
          ...names.filter((n: string) => !(n in transitions)).map((n: string) => `no transitions entry for ${n}`),
        ]
        if (bad.length) throw new OntologyError(`${file}: lifecycle refers to unknown values: ${[...new Set(bad)].join(', ')}`)
      }
      valueTypes.set(id, { id, kind: 'enum', values, initial: spec.initialValue, transitions })
    } else if (spec.valueKind === 'numeric_value') {
      valueTypes.set(id, { id, kind: 'number', min: spec.numericConstraint?.min, max: spec.numericConstraint?.max })
    } else if (spec.valueKind === 'structured') {
      valueTypes.set(id, { id, kind: 'struct', fields: (spec.fields ?? []).map(toField) })
    } else {
      throw new OntologyError(`${file}: unsupported valueKind "${spec.valueKind}"`)
    }
  }

  const objects = new Map<string, ObjectDef>()
  for (const { file, doc } of readYamlDir(join(dir, 'objects'))) {
    if (doc?.kind !== 'ObjectType') continue
    const id = doc.metadata?.id
    if (!id) throw new OntologyError(`${file}: metadata.id is missing`)
    objects.set(id, { id, apiName: doc.metadata.apiName, file, properties: (doc.spec?.properties ?? []).map(toField) })
  }

  const unresolved: string[] = []
  const refs = [
    ...[...objects.values()].flatMap((o) => o.properties.map((p) => [o.id, p] as const)),
    ...[...valueTypes.values()].flatMap((vt) => (vt.kind === 'struct' ? vt.fields.map((f) => [vt.id, f] as const) : [])),
  ]
  for (const [owner, f] of refs) {
    if (!EXTERNAL_PRIMITIVES[f.valueTypeRef] && !valueTypes.has(f.valueTypeRef)) unresolved.push(`${owner}.${f.apiName} → ${f.valueTypeRef}`)
  }
  const relations: string[] = []
  for (const { file, doc } of readYamlDir(join(dir, 'relations'))) {
    if (doc?.kind !== 'RelationType') continue
    const id = doc.metadata?.id ?? file
    relations.push(id)
    for (const a of doc.spec?.accessors ?? []) {
      for (const ref of [a.fromTypeRef, a.returnsTypeRef]) if (!objects.has(ref)) unresolved.push(`${id}.${a.apiName} → ${ref}`)
    }
  }

  const functions: string[] = []
  for (const { file, doc } of readYamlDir(join(dir, 'functions'))) {
    if (doc?.kind !== 'Function') continue
    const id = doc.metadata?.id ?? file
    functions.push(id)
    for (const p of [...(doc.spec?.input?.parameters ?? []), ...(doc.spec?.output?.parameters ?? [])]) {
      const ref = String(p.valueTypeRef)
      if (!EXTERNAL_PRIMITIVES[ref] && !valueTypes.has(ref) && !objects.has(ref)) unresolved.push(`${id}.${p.apiName} → ${ref}`)
    }
  }

  if (unresolved.length) throw new OntologyError(`Unresolved type references: ${unresolved.join('; ')}`)

  const conditionFile = join(dir, 'config', 'judgment-conditions.yaml')
  if (!existsSync(conditionFile)) throw new OntologyError(`Judgment conditions not found: ${conditionFile}`)
  let raw: any
  try {
    raw = parse(readFileSync(conditionFile, 'utf8'))
  } catch (e) {
    throw new OntologyError(`config/judgment-conditions.yaml: invalid YAML (${(e as Error).message})`)
  }
  if (!Array.isArray(raw?.conditions)) throw new OntologyError('config/judgment-conditions.yaml: expected a "conditions:" list')
  const probe = new Ontology(dir, valueTypes, objects, [], {}, relations, functions)
  const def = objects.get(JUDGMENT_CONDITION_TYPE)
  if (!def) throw new OntologyError(`Object type ${JUDGMENT_CONDITION_TYPE} not found`)
  const errors = (raw.conditions as unknown[]).flatMap((c, i) => probe.validateFields(def.properties, c, `conditions[${i}]`))
  const bandErrors = Object.entries(raw.flatBands ?? {}).flatMap(([k, b]: [string, any]) =>
    typeof b?.value === 'number' && typeof b?.confirmed === 'boolean' && typeof b?.source === 'string'
      ? probe.validateValue('logos.seo.value.change-kind', b.unit, `flatBands.${k}.unit`)
      : [`flatBands.${k}: needs value (number), unit, confirmed (true/false) and source`],
  )
  if (errors.length || bandErrors.length) throw new OntologyError(`config/judgment-conditions.yaml: ${[...errors, ...bandErrors].join('; ')}`)
  const ids = (raw.conditions as JudgmentCondition[]).map((c) => c.conditionId)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length) throw new OntologyError(`config/judgment-conditions.yaml: duplicate conditionId ${dupes.join(', ')}`)

  const ontology = new Ontology(dir, valueTypes, objects, raw.conditions, raw.flatBands ?? {}, relations, functions)
  return ontology
}

export const defaultOntologyDir = process.env.SEO_ONTOLOGY_DIR ?? fileURLToPath(new URL('../../yaml/', import.meta.url))
