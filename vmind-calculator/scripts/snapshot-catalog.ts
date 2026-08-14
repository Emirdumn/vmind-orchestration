/**
 * FAZ 0.C — Canli katalog snapshot'i
 *
 *   npm run snapshot:catalog
 *
 * fixtures/catalog/*.json dosyalarini tazeler ve docs/catalog-report.md'yi
 * yeniden uretir. Testler bu snapshot'a karsi calistigi icin, katalog degistiginde
 * once bu script, sonra `npm test` calistirilmali.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlatformApiClient } from '../src/platform/api-client.js';
import { Catalog } from '../src/core/catalog/catalog.js';
import { SERVICE_CODES } from '../src/core/schema/estimate.js';
import { PRODUCT_SERVICE_BY_ESTIMATE_SERVICE } from '../src/core/catalog/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = join(root, 'fixtures', 'catalog');

async function main(): Promise<void> {
  const client = new PlatformApiClient();
  console.log('Katalog cekiliyor...');

  const [products, flavors, volumeTypes] = await Promise.all([
    client.getProducts(),
    client.getFlavors(),
    client.getVolumeTypes(),
  ]);

  mkdirSync(catalogDir, { recursive: true });
  const write = (name: string, data: unknown): void => {
    writeFileSync(join(catalogDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`  yazildi: fixtures/catalog/${name}`);
  };
  write('products.json', products);
  write('flavors.json', flavors);
  write('volume-types.json', volumeTypes);

  const fetchedAt = new Date().toISOString();
  const catalog = Catalog.fromEnvelopes(products, flavors, volumeTypes, fetchedAt);
  writeFileSync(join(root, 'docs', 'catalog-report.md'), buildReport(catalog, fetchedAt), 'utf8');
  console.log('  yazildi: docs/catalog-report.md');
}

function buildReport(catalog: Catalog, fetchedAt: string): string {
  const lines: string[] = [];
  const push = (s = ''): number => lines.push(s);

  push('# Katalog Raporu (FAZ 0.C)');
  push();
  push('> OTOMATIK URETILDI — `npm run snapshot:catalog`. Elle duzenlemeyin.');
  push(`> Snapshot: \`${fetchedAt}\``);
  push();
  push(`- Urun sayisi: **${catalog.products.length}**`);
  push(`- Instance tipi (flavor): **${catalog.flavors.length}**`);
  push(`- Volume type: **${catalog.volumeTypes.length}**`);
  push(`- Katalogda gecen para birimleri: ${catalog.currencies().map((c) => `\`${c}\``).join(', ')}`);
  push();

  push('## GATE 1 — 9 servis kodunun urun eslesmesi');
  push();
  push('| Servis kodu | `product.service` | Urun sayisi | Ornek kodlar |');
  push('|---|---|---:|---|');
  for (const service of SERVICE_CODES) {
    const productServices = PRODUCT_SERVICE_BY_ESTIMATE_SERVICE[service] as readonly string[];
    const matches = catalog.products.filter((p) => productServices.includes(p.service));
    const sample = matches.slice(0, 3).map((p) => `\`${p.productCode.slice(0, 12)}\``).join(', ');
    push(`| \`${service}\` | ${productServices.join(', ')} | ${matches.length} | ${sample} |`);
  }
  push();

  push('## GATE 2 — Secili para biriminde fiyati OLMAYAN urunler');
  push();
  push('Bu urunler, o para birimi secildiginde platformun hesaplayicisini cokertir');
  push('(`priceObj.price` -> TypeError). Ajan bu para birimlerini kullanmamalidir.');
  push();
  push('| Para birimi | Fiyati eksik urun | Sonuc |');
  push('|---|---|---|');
  for (const currency of catalog.currencies()) {
    const missing = catalog.productsMissingPrice(currency);
    const verdict = missing.length === 0 ? 'KULLANILABILIR' : 'KULLANILAMAZ';
    const list = missing.length ? missing.map((p) => `\`${p.productCode}\``).join(', ') : '—';
    push(`| \`${currency}\` | ${list} | **${verdict}** |`);
  }
  push();

  push('## GATE 3 — Paylasim linki formati');
  push();
  push('Uretim bundle\'indaki `PrintView` bileseninden birebir:');
  push();
  push('```js');
  push('const shareUrl = `${appConfig.calculatorUrl}/my-estimate/${input.data.id}`;');
  push('```');
  push();
  push(`Ornek: \`${PlatformApiClient.shareUrl('<estimateId>')}\``);
  push();
  push('`estimateId`, `POST /billing/estimateplan` govdesindeki `key` alanidir.');
  push('Link tarayici acmadan uretilebilir.');
  push();

  push('## Secilemeyen compute urunleri');
  push();
  push('Fiyat katalogunda var, ancak `compute/flavors` listesinde YOK.');
  push('Arayuzden secilemezler; ajan da onermemelidir.');
  push();
  const unselectable = catalog.unselectableComputeProducts();
  if (unselectable.length === 0) {
    push('_Yok._');
  } else {
    push('| Urun | Kod |');
    push('|---|---|');
    for (const p of unselectable) push(`| ${p.productName} | \`${p.productCode}\` |`);
  }
  push();

  push('## Fiyatlandirma birimi dagilimi');
  push();
  push('`pricingUnit` "HOUR" DEGILSE aylik tutar x720 ile carpilmaz (`fiyat x miktar` olarak kalir).');
  push();
  const byUnit = new Map<string, string[]>();
  for (const p of catalog.products) {
    const unit = p.prices[0]?.pricingUnit ?? '(fiyat yok)';
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit)!.push(p.productCode);
  }
  push('| `pricingUnit` | Adet | Aylik carpani | Urunler |');
  push('|---|---:|---|---|');
  for (const [unit, codes] of byUnit) {
    const multiplier = unit === 'HOUR' ? '`x720`' : '**yok**';
    const shown = codes.length > 6 ? `${codes.slice(0, 6).map((c) => `\`${c.slice(0, 12)}\``).join(', ')} … (+${codes.length - 6})` : codes.map((c) => `\`${c.slice(0, 12)}\``).join(', ');
    push(`| \`${unit}\` | ${codes.length} | ${multiplier} | ${shown} |`);
  }
  push();

  push('## Tum urunler');
  push();
  push('| `product.service` | `productCode` | Ad | Fiyatlar |');
  push('|---|---|---|---|');
  for (const p of catalog.products) {
    const prices = p.prices.map((x) => `${x.currency} ${x.price}/${x.pricingUnit}`).join('<br>');
    push(`| ${p.service} | \`${p.productCode}\` | ${p.productName} | ${prices} |`);
  }
  push();

  push('## Instance tipleri');
  push();
  push('| Ad | vCPU | RAM (GB) | GPU | vRAM (GB) | Aile |');
  push('|---|---:|---:|---:|---:|---|');
  for (const f of [...catalog.flavors].sort((a, b) => a.name.localeCompare(b.name))) {
    push(`| ${f.name} | ${f.vcpus} | ${f.ram / 1024} | ${f.vgpus} | ${f.vram / 1024} | ${f.computeFamily ?? '—'} |`);
  }
  push();

  push('## Volume type\'lar');
  push();
  push('| Ad | `productCode` (= `id`) |');
  push('|---|---|');
  for (const v of catalog.volumeTypes) push(`| ${v.name} | \`${v.productCode}\` |`);
  push();

  return `${lines.join('\n')}\n`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
