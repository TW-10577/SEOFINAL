import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { type Ontology, OntologyError } from './ontology.ts'
import type { MeasurementConfig } from './types.ts'

const FILE = 'config/measurements.yaml'
const TEXT = ['measurementId', 'number', 'name', 'conditionId', 'primarySource', 'supportedBy'] as const
const SOURCE_TEXT = ['files', 'source', 'memo1', 'memo2', 'import', 'sampleDateRange', 'dummyDateRange', 'measurement1', 'measurement2'] as const

// Read the measurement sheet and check it points at conditions and data sources the ontology knows.
export function loadMeasurements(dir: string, ontology: Ontology): MeasurementConfig {
  const file = join(dir, FILE)
  if (!existsSync(file)) throw new OntologyError(`Measurements not found: ${file}`)
  let raw: any
  try {
    raw = parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new OntologyError(`${FILE}: invalid YAML (${(e as Error).message})`)
  }
  if (!Array.isArray(raw?.measurements) || !Array.isArray(raw?.dataSources)) {
    throw new OntologyError(`${FILE}: expected "measurements:" and "dataSources:" lists`)
  }

  const conditionIds = ontology.conditions.map((c) => c.conditionId)
  const kinds = ontology.enumValues('logos.seo.value.data-source')
  const errors: string[] = []
  raw.measurements.forEach((m: any, i: number) => {
    for (const k of TEXT) if (typeof m?.[k] !== 'string') errors.push(`measurements[${i}].${k}: required text`)
    if (typeof m?.conditionId === 'string' && !conditionIds.includes(m.conditionId)) {
      errors.push(`measurements[${i}].conditionId: ${m.conditionId} is not in judgment-conditions.yaml`)
    }
    if (!Array.isArray(m?.branches) || m.branches.some((b: any) => typeof b?.when !== 'string' || typeof b?.then !== 'string')) {
      errors.push(`measurements[${i}].branches: a list of { when, then }`)
    }
  })
  raw.dataSources.forEach((s: any, i: number) => {
    if (typeof s?.no !== 'number') errors.push(`dataSources[${i}].no: required number`)
    for (const k of SOURCE_TEXT) if (typeof s?.[k] !== 'string') errors.push(`dataSources[${i}].${k}: required text`)
    if (!Array.isArray(s?.sourceKinds)) errors.push(`dataSources[${i}].sourceKinds: required list`)
    else for (const k of s.sourceKinds) if (!kinds.includes(k)) errors.push(`dataSources[${i}].sourceKinds: unknown data source "${k}"`)
  })
  if (errors.length) throw new OntologyError(`${FILE}: ${errors.join('; ')}`)
  return { measurements: raw.measurements, dataSources: raw.dataSources }
}
