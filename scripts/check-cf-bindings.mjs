#!/usr/bin/env node
/**
 * Guard: cloudflare.config.ts must stay in sync with the Wrangler config.
 *
 * `cf deploy` reads `cloudflare.config.ts` only. A binding, cron schedule, or
 * Durable Object class that upstream adds to `wrangler.toml` or
 * `wrangler.kv.toml` would otherwise be silently dropped from the deployment,
 * because nothing else fails. Compare both files and fail loudly instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfConfigPath = path.join(root, 'cloudflare.config.ts');

/** Wrangler sections that declare a binding, keyed by the field holding its name. */
const BINDING_SECTIONS = new Map([
  ['d1_databases', 'binding'],
  ['r2_buckets', 'binding'],
  ['kv_namespaces', 'binding'],
  ['queues.producers', 'binding'],
  ['services', 'binding'],
  ['durable_objects.bindings', 'name'],
  ['assets', 'binding'],
]);

function readIfPresent(file) {
  const full = path.join(root, file);
  return fs.existsSync(full) ? { file, text: fs.readFileSync(full, 'utf8') } : null;
}

function parseWrangler(text) {
  const bindings = new Set();
  const crons = new Set();
  const durableObjectClasses = new Set();
  const vars = new Set();

  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const header = line.match(/^\[\[?(.+?)\]\]?$/);
    if (header) {
      section = header[1];
      continue;
    }

    // Environment blocks inherit their own scope; skip them so only the
    // top-level deployment surface is compared.
    if (section.startsWith('env.')) continue;

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');

    const bindingField = BINDING_SECTIONS.get(section);
    if (bindingField === key && value) bindings.add(value);

    if (section === 'vars') vars.add(key);
    if (section === 'secrets.required') vars.add(key);

    if (section === 'triggers' && key === 'crons') {
      for (const cron of rawValue.match(/"([^"]+)"|'([^']+)'/g) || []) {
        crons.add(cron.replace(/^["']|["']$/g, ''));
      }
    }

    if (section === 'migrations' && (key === 'new_sqlite_classes' || key === 'new_classes')) {
      for (const klass of rawValue.match(/"([^"]+)"|'([^']+)'/g) || []) {
        durableObjectClasses.add(klass.replace(/^["']|["']$/g, ''));
      }
    }
  }

  return { bindings, crons, durableObjectClasses, vars };
}

// `wrangler.toml` drives the deployed pipeline (R2 mode), so it is the source
// of truth. `wrangler.kv.toml` is the optional KV alternative and may declare
// bindings that the R2-mode deployment deliberately does not include.
const primary = readIfPresent('wrangler.toml');
if (!primary) {
  console.error('[check-cf-bindings] wrangler.toml not found; nothing to compare');
  process.exit(1);
}

const cfConfig = fs.readFileSync(cfConfigPath, 'utf8');
const declared = (name) => new RegExp(`(^|[^A-Za-z0-9_])${name}\\s*:`, 'm').test(cfConfig);

const expected = parseWrangler(primary.text);
// Bindings may be declared either as a secret or as a text binding; both are
// name-presence checks, so treat vars as ordinary binding names.
for (const name of expected.vars) expected.bindings.add(name);

const missing = {
  bindings: [...expected.bindings].filter((name) => !declared(name)),
  crons: [...expected.crons].filter((cron) => !cfConfig.includes(cron)),
  durableObjectClasses: [...expected.durableObjectClasses].filter((name) => !declared(name)),
};

const problems = Object.entries(missing).filter(([, list]) => list.length > 0);
if (problems.length === 0) {
  console.log(
    `[check-cf-bindings] cloudflare.config.ts matches ${primary.file} ` +
      `(${expected.bindings.size} bindings, ${expected.crons.size} cron, ${expected.durableObjectClasses.size} Durable Object exports)`
  );
  process.exit(0);
}

console.error('[check-cf-bindings] cloudflare.config.ts is out of sync with the Wrangler config.\n');
for (const [kind, list] of problems) {
  console.error(`  missing ${kind}: ${list.join(', ')}`);
}
console.error(
  '\n`cf deploy` reads cloudflare.config.ts only, so anything missing above would not be\n' +
    'deployed. Add it to cloudflare.config.ts (worker.env, worker.triggers, worker.exports),\n' +
    'then run the build again.'
);
process.exit(1);
