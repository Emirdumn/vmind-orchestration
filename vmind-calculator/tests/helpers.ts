/** Test yardimcilari — katalog ve kural motoru kurulumu. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

const readEnvelope = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(ROOT, 'fixtures', 'catalog', name), 'utf8'));

export const catalog = Catalog.fromEnvelopes(
  readEnvelope<Product>('products.json'),
  readEnvelope<Flavor>('flavors.json'),
  readEnvelope<VolumeType>('volume-types.json'),
);

export const RULES_YAML = readFileSync(join(ROOT, 'rules', 'estimate-rules.yaml'), 'utf8');

export const makeRuleEngine = (): RuleEngine => RuleEngine.fromYaml(RULES_YAML, catalog);

/** Gercek katalog kodlari (tests/scenarios.ts ile ayni). */
export const CODE = {
  flavorSmall: '73dee111-ff30-4837-b3c1-9284c422485e',
  flavorMedium: 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb',
  volumePremium: '096439fe-26d6-4bd0-bdf0-11e40f73753e',
  volumeStandard: 'bd0bbcfb-c178-4d21-b661-1b67c43b8c60',
  netOut: 'NETW-OUT-001',
  floatingIp: 'FIP-001',
  lbApp: 'LB-001',
  objectStorage: 'OBS-001',
  backup: 'BC-001',
  bogus: 'UYDURMA-KOD-999',
} as const;
