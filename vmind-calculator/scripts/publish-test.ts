/**
 * GERCEK PLATFORM TESTI — dort kapinin sonuna kadar yurur.
 *
 *   npm run publish:test              # DRY-RUN: ne gonderilecegini yazar, YAZMAZ
 *   npm run publish:test -- --live    # GERCEK YAZMA (VMind'de kalici teklif olusur)
 *
 * Neden ayri bir betik: `publish.save({dryRun:false})` bu projede bugune kadar
 * hic calistirilmadi. Cevaplanmamis somut bir soru var — backend'in dondurdugu
 * `data.id`, bizim gonderdigimiz `key` ile ayni mi? Ayni degilse `shareUrl`
 * OLU BIR LINK doner ve o link musteriye giden ciktinin kendisidir.
 * Bu betik tam olarak onu olcer:
 *
 *   yaz -> geri oku -> donen id'yi gonderdigimiz key ile karsilastir -> reconcile
 *
 * `--live` verilmedikce hicbir yazma yapilmaz.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { AuditTrail } from '../src/core/telemetry/audit.js';
import { PlatformApiClient } from '../src/platform/api-client.js';
import {
  approvalTools,
  createToolContext,
  priceTools,
  publishTools,
  validateTools,
} from '../src/mcp/tools/index.js';
import { parseRemoteEstimate, reconcile } from '../src/agents/reconciler.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));

const catalog = Catalog.fromEnvelopes(
  read<Product>('products.json'),
  read<Flavor>('flavors.json'),
  read<VolumeType>('volume-types.json'),
);
const rules = RuleEngine.fromYaml(
  readFileSync(join(root, 'rules', 'estimate-rules.yaml'), 'utf8'),
  catalog,
);

const line = (s = ''): void => console.log(s);
const title = (s: string): void => {
  line();
  line('='.repeat(70));
  line(`  ${s}`);
  line('='.repeat(70));
};

/**
 * BLOCKER'SIZ, eksiksiz bir teklif. Amac kural motorunu sinamak degil (bunu
 * `npm run demo` yapiyor) — dort kapinin sonuna kadar yurumek.
 */
function buildCleanEstimate(session: EstimateSession): void {
  session.addItem('compute', {
    productCode: 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb', // g1.medium
    count: 2,
    storage: {
      productCode: '096439fe-26d6-4bd0-bdf0-11e40f73753e', // Premium-SSD
      size: 50,
      unit: 'GB',
      volumeTypeName: 'PortvMind-Premium-SSD',
    },
    network: { productCode: 'NETW-OUT-001', traffic: 100, unit: 'GB' },
  });
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const trail = new AuditTrail();

  // Istemci yalnizca --live ile yazma yetkisi alir. Dry-run'da salt-okunur
  // kalmasi bilincli: kaza ile yazmanin yolu olmasin.
  const client = new PlatformApiClient({ allowWrites: live });

  const session = new EstimateSession(catalog, {
    currency: 'TL',
    name: `[TEST] VMind Teklif Ajani — ${live ? 'canli' : 'dry-run'}`,
  });
  const ctx = createToolContext(catalog, rules, { session, audit: trail, client });

  title(live ? 'CANLI YAZMA MODU' : 'DRY-RUN (hicbir sey yazilmaz)');
  line(`  allowWrites : ${live}`);
  line(`  Teklif adi  : ${session.read().name}`);
  line(`  Yerel id    : ${session.read().id}`);

  buildCleanEstimate(session);

  // --- kapi 2: kural motoru -----------------------------------------------
  title('KAPI 2 — kural motoru');
  const report = validateTools.check(ctx);
  line(`  Bulgu: ${report.gaps.length} | blocker: ${report.blockers.length}`);
  for (const gap of report.gaps) line(`    [${gap.severity}] ${gap.ruleId}`);
  line(`  Yayinlanabilir: ${report.publishable ? 'EVET' : 'HAYIR'}`);
  if (!report.publishable) {
    line('  Blocker var — burada duruyoruz. Teklifi duzeltmeden yazilamaz.');
    return;
  }

  const price = priceTools.calculate(ctx);
  line(`  Tutar: ${price.totalMonthCost.toFixed(2)} ${price.currency}/ay`);

  // --- kapi 1: dryRun varsayilani -----------------------------------------
  title('KAPI 1 — dryRun varsayilani (parametre verilmedi)');
  const dry = await publishTools.save(ctx);
  line(`  dryRun dondu : ${dry.dryRun}`);
  line(`  shareUrl     : ${dry.shareUrl}`);
  line();
  line('  PLATFORMA GIDECEK GOVDE (POST /billing/estimateplan):');
  const estimate = session.toEstimate();
  const body = { key: estimate.id, json: JSON.stringify(estimate) };
  line(`    key  : ${body.key}`);
  line(`    json : ${body.json.slice(0, 200)}${body.json.length > 200 ? '…' : ''}`);
  line(`           (${body.json.length} karakter)`);

  if (!live) {
    title('DURDU — gercek yazma yapilmadi');
    line('  Yazmak icin:  npm run publish:test -- --live');
    line('  Bu VMind sisteminde KALICI bir teklif olusturur.');
    return;
  }

  // --- kapi 3: HITL onayi --------------------------------------------------
  title('KAPI 3 — HITL onayi');
  line('  Onaysiz deneme:');
  try {
    await publishTools.save(ctx, { dryRun: false });
    line('  !!! BEKLENMEDIK: onaysiz yazma GECTI — bu bir guvenlik hatasidir.');
    process.exitCode = 1;
    return;
  } catch (error) {
    line(`  reddedildi (beklenen): ${(error as Error).name}`);
  }

  approvalTools.grant(ctx, { approvedBy: 'emirduman@gmail.com (canli test)' });
  trail.approval('emirduman@gmail.com (canli test)');
  line('  Onay verildi.');

  // --- gercek yazma --------------------------------------------------------
  title('GERCEK YAZMA');
  const saved = await publishTools.save(ctx, { dryRun: false });
  line(`  saved        : ${saved.saved}`);
  line(`  estimateId   : ${saved.estimateId}`);
  line(`  shareUrl     : ${saved.shareUrl}`);
  line(`  ham cevap    : ${JSON.stringify(saved.response).slice(0, 400)}`);

  // --- ASIL OLCUM: geri oku, id'yi karsilastir -----------------------------
  title('GERI OKUMA — `data.id` == gonderdigimiz `key` mi?');
  const remote = await client.getEstimate(estimate.id);
  const raw = JSON.stringify(remote);
  line(`  ham cevap: ${raw.slice(0, 500)}${raw.length > 500 ? '…' : ''}`);

  const remoteId = findId(remote);
  line();
  line(`  gonderdigimiz key : ${estimate.id}`);
  line(`  donen data.id     : ${remoteId ?? '(bulunamadi)'}`);
  if (remoteId && remoteId !== estimate.id) {
    line();
    line('  >>> AYRI. shareUrl YANLIS URETILIYOR. PrintView `data.id` kullaniyor,');
    line(`  >>> dogru link: ${PlatformApiClient.shareUrl(remoteId)}`);
    line('  >>> api-client.shareUrl cagrisi backend id ile beslenmeli.');
    process.exitCode = 1;
  } else if (remoteId) {
    line('  >>> AYNI. shareUrl dogru uretiliyor.');
  }

  // --- reconcile ------------------------------------------------------------
  title('RECONCILE — tutar platformda korunmus mu?');
  const result = reconcile(catalog, price, parseRemoteEstimate(remote));
  line(`  ok         : ${result.ok}`);
  line(`  aylik fark : ${result.monthlyDiff}`);
  line(`  mesaj      : ${result.message}`);
  if (!result.ok) process.exitCode = 1;

  title('DENETIM IZI');
  line(trail.render().split('\n').map((l) => `  ${l}`).join('\n'));

  title('TEMIZLIK');
  line(`  Olusan teklif VMind'de KALICI: ${saved.shareUrl}`);
  line('  Silme ucu bilinmiyor; gerekirse VMind tarafindan temizlenmeli.');
}

/**
 * Zarfin icindeki teklif id'sini bulur.
 *
 * Ilk surum yalnizca nesneleri geziyordu ve id'yi bulamadi: platform teklifi
 * `item` alaninda JSON STRING olarak dondurdugu icin agac orada bitiyordu.
 * String degerler de parse edilmeli.
 */
function findId(payload: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): string | undefined => {
    if (depth > 5) return undefined;
    if (typeof node === 'string') {
      if (!node.trimStart().startsWith('{')) return undefined;
      try {
        return walk(JSON.parse(node), depth + 1);
      } catch {
        return undefined;
      }
    }
    if (node === null || typeof node !== 'object' || seen.has(node)) return undefined;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record['id'] === 'string') return record['id'];
    if (typeof record['key'] === 'string') return record['key'];
    for (const value of Object.values(record)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(payload, 0);
}

main().catch((error: unknown) => {
  console.error('\nHATA:', (error as Error).message);
  process.exitCode = 1;
});
