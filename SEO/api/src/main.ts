import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { DEFAULT_DB_PATH, openDb } from './db.ts';
import { loadOntology, startupProblems } from './ontology.ts';

const port = Number(process.env.PORT ?? 8787);
const cfg = loadConfig();
// The ontology is the source of truth for lifecycles and vocabularies; refuse to start without a valid one.
const ont = loadOntology();
const problems = startupProblems(ont, cfg.rules.map((r) => ({ id: r.id, thresholdUnit: r.thresholdUnit, direction: r.direction, conditionType: r.conditionType })));
if (problems.length) {
  console.error(`Ontology / rule configuration mismatch:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
const app = createApp(openDb(), cfg, ont);
serve({ fetch: app.fetch, port }, () =>
  console.log(
    `LOGOS SEO API on http://localhost:${port}/api · database ${process.env.SEO_DB_PATH ?? DEFAULT_DB_PATH} · ontology ${ont.packageId}@${ont.version} (${ont.definitions.size} definitions)`,
  ),
);
