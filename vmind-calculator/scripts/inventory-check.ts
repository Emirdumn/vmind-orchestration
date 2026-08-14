import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { assessCatalogInventory } from '../src/core/catalog/inventory.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));
const catalog = Catalog.fromEnvelopes(
  read<Product>('products.json'), read<Flavor>('flavors.json'), read<VolumeType>('volume-types.json'),
);
const report = assessCatalogInventory(catalog);
const outputArg = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
const output = outputArg || process.env['INVENTORY_REPORT_FILE'];
if (output) {
  const target = resolve(output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.ready ? 0 : 1;
