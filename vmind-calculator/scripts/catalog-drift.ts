/**
 * FAZ 2.C — Drift kontrolü (günlük çalışacak)
 *
 *   npm run drift
 *
 * Kaydedilmiş snapshot ile canlı katalog/bundle'ı karşılaştırır.
 * Çıkış kodu:  0 = temiz veya yalnızca uyarı   1 = durdurucu (blocker) var
 * CI bu çıkış kodunu kullanır.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlatformApiClient } from '../src/platform/api-client.js';
import {
  detectBundleDrift,
  detectCatalogDrift,
  driftVerdict,
  type BundleRef,
  type DriftFinding,
} from '../src/core/catalog/drift.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CALCULATOR_URL = 'https://calculator.portvmind.com';

const readFixture = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));

/** Ana sayfadaki <script src="/assets/index-<hash>.js"> referansını okur. */
async function fetchBundleRef(): Promise<BundleRef> {
  const html = await (await fetch(CALCULATOR_URL)).text();
  const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!match) throw new Error('Bundle referansı bulunamadı — sayfa yapısı değişmiş olabilir.');
  const asset = match[0];

  const head = await fetch(`${CALCULATOR_URL}/${asset}`, { method: 'HEAD' });
  const ref: BundleRef = { asset };
  const etag = head.headers.get('etag');
  const lastModified = head.headers.get('last-modified');
  const length = head.headers.get('content-length');
  if (etag) ref.etag = etag;
  if (lastModified) ref.lastModified = lastModified;
  if (length) ref.contentLength = Number(length);
  return ref;
}

function print(findings: DriftFinding[]): void {
  const icon = { blocker: 'BLOCKER', warning: 'UYARI  ', info: 'BILGI  ' } as const;
  for (const f of findings) {
    console.log(`  [${icon[f.severity]}] ${f.kind.padEnd(20)} ${f.message}`);
  }
}

async function main(): Promise<void> {
  const client = new PlatformApiClient();

  const [products, flavors, volumeTypes, bundleRef] = await Promise.all([
    client.getProducts(),
    client.getFlavors(),
    client.getVolumeTypes(),
    fetchBundleRef(),
  ]);

  const findings: DriftFinding[] = [
    ...detectCatalogDrift(
      {
        products: readFixture<Product>('products.json').items,
        flavors: readFixture<Flavor>('flavors.json').items,
        volumeTypes: readFixture<VolumeType>('volume-types.json').items,
      },
      { products: products.items, flavors: flavors.items, volumeTypes: volumeTypes.items },
    ),
  ];

  const bundlePath = join(root, 'fixtures', 'catalog', 'bundle.json');
  let recordedBundle: BundleRef | undefined;
  try {
    recordedBundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as BundleRef;
  } catch {
    console.log('Kayıtlı bundle referansı yok — ilk çalıştırma, kaydediliyor.');
    writeFileSync(bundlePath, `${JSON.stringify(bundleRef, null, 2)}\n`, 'utf8');
  }
  if (recordedBundle) findings.push(...detectBundleDrift(recordedBundle, bundleRef));

  const verdict = driftVerdict(findings);

  if (findings.length === 0) {
    console.log('Drift yok — katalog ve bundle snapshot ile aynı.');
  } else {
    console.log(`${findings.length} bulgu:`);
    print(findings);
  }

  console.log();
  if (verdict === 'stop') {
    console.log('KARAR: DUR. Durdurucu bulgu var; ajan teklif üretmemeli.');
    console.log('       Katalog: npm run snapshot:catalog && npm test');
    console.log('       Bundle : docs/pricing-port-notes.md §5');
    process.exitCode = 1;
  } else if (verdict === 'proceed-with-warning') {
    console.log('KARAR: UYARIYLA DEVAM. Fiyat farkları teklif özetinde belirtilmeli.');
  } else {
    console.log('KARAR: TEMIZ.');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
