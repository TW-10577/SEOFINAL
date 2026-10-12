import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { deleteDatalessRuns } from './import/index.ts';
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
// PostgreSQL from DATABASE_URL; refuse to start when the database cannot be reached.
const db = await openDb().catch((e: Error) => {
  console.error(`Database connection failed: ${e.message}`);
  process.exit(1);
});
// Runs whose data has been deleted (e.g. made before any upload) only show empty dates: remove them.
const stale = await deleteDatalessRuns(db);
if (stale.length) console.log(`Removed measurement runs without data: #${stale.join(', #')}`);
const app = createApp(db, cfg, ont);
serve({ fetch: app.fetch, port }, () =>
  console.log(
    `LOGOS SEO API on http://localhost:${port}/api · database ${db.label} · ontology ${ont.packageId}@${ont.version} (${ont.definitions.size} definitions)`,
  ),
);
