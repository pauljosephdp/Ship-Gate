// Regenerates scripts/schema-org-types.json: every schema.org type that names who is
// behind a site (Organization and all its subtypes, LocalBusiness and all of its).
// Run after a schema.org release: node tools/schema-org-types.mjs
import { writeFileSync } from 'node:fs';

const SRC = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const graph = (await (await fetch(SRC)).json())['@graph'];
const parents = new Map();
for (const n of graph) {
  if ([].concat(n['@type']).includes('rdfs:Class'))
    parents.set(n['@id'].replace('schema:', ''), [].concat(n['rdfs:subClassOf'] ?? []).map((p) => p['@id'].replace('schema:', '')));
}
const isA = (t, root, seen = new Set()) => t === root
  || (!seen.has(t) && (seen.add(t), (parents.get(t) ?? []).some((p) => isA(p, root, seen))));
const all = [...parents.keys()].sort();
const out = {
  source: SRC,
  localBusiness: all.filter((t) => isA(t, 'LocalBusiness')),
  organization: all.filter((t) => isA(t, 'Organization')),
};
writeFileSync(new URL('../scripts/schema-org-types.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`${out.organization.length} Organization types, ${out.localBusiness.length} of them LocalBusiness.`);
