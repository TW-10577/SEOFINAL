import { defaultOntologyDir, loadOntology, OntologyError } from './ontology.ts'
import { createApp } from './server.ts'
import { SeoService } from './service.ts'
import { defaultDbFile, SeoDatabase } from './db.ts'

const PORT = Number(process.env.PORT ?? 8787)

let service: SeoService
try {
  service = new SeoService(new SeoDatabase(defaultDbFile), loadOntology(defaultOntologyDir))
} catch (e) {
  console.error(`${e instanceof OntologyError ? 'Ontology check failed' : 'Startup failed'}, not starting.\n  ${(e as Error).message}`)
  process.exit(1)
}

createApp(service).listen(PORT, () => {
  const o = service.ontology.summary()
  console.log(`SEO API listening on http://localhost:${PORT}`)
  console.log(`  ontology: ${o.dir} (${o.objects.length} object types, ${o.relations.length} relations, ${o.functions.length} functions, ${Object.keys(o.enums).length} enums, ${o.conditions.length} judgment conditions)`)
  console.log(`  database: ${defaultDbFile}`)
})
