/**
 * DEMO — sistemi elle denemenin yolu.
 *
 *   npm run demo -- "Musteri 4 sunucu istiyor, load balancer olsun, premium disk olsun"
 *   npm run demo                    # LLM'siz demo (kredi harcamaz)
 *
 * Satisci cumlesinden teklife giden TUM akisi calistirip her adimi ekrana yazar.
 *
 * ASLA YAYINLAMAZ. `publish.save` yalnizca dry-run olarak cagrilir; gercek
 * yazma icin VMind hesabi ve acik onay gerekir (bkz. README).
 *
 * LLM anahtari yoksa akis `--no-llm` moduna duser: hazir bir teklifle
 * deterministik yari (kural motoru, fiyat, denetim izi, onay ekrani)
 * gosterilir. Boylece sistemin buyuk kismi kredi harcamadan gorulebilir.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { AuditTrail } from '../src/core/telemetry/audit.js';
import { createToolContext, priceTools } from '../src/mcp/tools/index.js';
import { Auditor } from '../src/agents/auditor.js';
import { RequirementExtractor } from '../src/agents/extractor.js';
import { SolutionDesigner } from '../src/agents/designer.js';
import { Orchestrator, renderApprovalScreen } from '../src/agents/orchestrator.js';
import { MissingCredentialsError, createLlm, type LlmClient } from '../src/agents/llm.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';
import type { AuditQuestion, PriceSnapshot } from '../src/agents/types.js';

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

// --- cikti yardimcilari ----------------------------------------------------

const line = (s = ''): void => console.log(s);
const title = (s: string): void => {
  line();
  line(`${'='.repeat(70)}`);
  line(`  ${s}`);
  line(`${'='.repeat(70)}`);
};
const money = (n: number, currency: string): string =>
  `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function printPrice(price: PriceSnapshot): void {
  const nameWidth = Math.max(...price.lines.map((l) => l.productName?.length ?? 0), 20);
  for (const l of price.lines) {
    const monthly = typeof l.monthly === 'number' ? money(l.monthly, price.currency) : String(l.monthly);
    line(`  ${(l.productName ?? '?').padEnd(nameWidth)}  ${String(l.count ?? '').padEnd(28)} ${monthly.padStart(16)}/ay`);
  }
  line(`  ${'-'.repeat(nameWidth + 48)}`);
  line(
    `  ${'TOPLAM'.padEnd(nameWidth)}  ${''.padEnd(28)} ${money(price.totalMonthCost, price.currency).padStart(16)}/ay`,
  );
  line(`  ${''.padEnd(nameWidth)}  ${''.padEnd(28)} ${(price.totalHourCost.toFixed(6) + ' ' + price.currency).padStart(16)}/saat`);
}

function printQuestions(questions: AuditQuestion[]): void {
  questions.forEach((q, i) => {
    line(`  ${i + 1}. [${q.severity}] ${q.question}`);
    line(`     (bos birakirsan: ${q.defaultAnswer})`);
  });
}

// --- LLM'siz demo ----------------------------------------------------------

/**
 * Kredi harcamadan sistemin deterministik yarisini gosterir.
 * Bilerek EKSIK bir teklif kurar — kural motorunun ne yakaladigi gorulsun.
 */
function buildDemoEstimate(session: EstimateSession): void {
  // 3 sunucu + premium disk + egress + floating IP (iyi kurulmus)
  session.addItem('compute', {
    productCode: 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb', // g1.medium
    count: 3,
    storage: {
      productCode: '096439fe-26d6-4bd0-bdf0-11e40f73753e', // Premium-SSD
      size: 100,
      unit: 'GB',
      volumeTypeName: 'PortvMind-Premium-SSD',
    },
    network: { productCode: 'NETW-OUT-001', traffic: 500, unit: 'GB' },
    floatingIp: { productCode: 'FIP-001', count: 1 },
  });
  // App load balancer — ama data transfer'i BILEREK eksik (kural yakalayacak)
  session.addItem('load-balancer', { productCode: 'LB-001' });
  // Object storage — network'u BILEREK eksik (blocker uretecek)
  session.addItem('object-storage', {
    storage: { productCode: 'OBS-001', size: 2, unit: 'TB' },
  });
}

// --- ana akis --------------------------------------------------------------

async function main(): Promise<void> {
  const salesText = process.argv.slice(2).join(' ').trim();

  // Iz ONCE olusturulur: LLM kullanimi da ize yazilmali. Ilk surumde `onUsage`
  // yalnizca yerel bir sayaca baglanmisti ve iz "LLM: 0 cagri" gosteriyordu —
  // $0.44 harcanmisken. Denetim izinin eksik olmasi kabul kriterini bozar.
  const trail = new AuditTrail();

  let llm: LlmClient | undefined;
  let providerLabel = 'YOK (LLM\'siz demo)';
  let spent = 0;
  let provider: 'openrouter' | 'anthropic' = 'openrouter';

  try {
    const selection = createLlm({
      onUsage: (u) => {
        spent += u.costUsd ?? 0;
        trail.llmUsage({ provider, ...u });
      },
    });
    llm = selection.client;
    provider = selection.provider;
    providerLabel = `${selection.provider} / ${selection.model}`;
  } catch (error) {
    if (!(error instanceof MissingCredentialsError)) throw error;
  }

  title('VMIND TEKLIF AJANI — DEMO');
  line(`  LLM saglayici : ${providerLabel}`);
  line(`  Katalog       : ${catalog.products.length} urun, ${catalog.flavors.length} instance tipi`);
  line(`  Kural sayisi  : ${rules.ruleCount}`);
  line(`  Yayinlama     : KAPALI (yalnizca dry-run — gercek teklif olusmaz)`);

  const ctx = createToolContext(catalog, rules, {
    session: new EstimateSession(catalog, { currency: 'TL', name: 'Demo Teklif' }),
    audit: trail,
  });

  const useLlm = Boolean(llm) && salesText.length > 0;

  if (!useLlm) {
    title('LLM\'SIZ MOD');
    if (!llm) {
      line('  LLM anahtari yok (OPENROUTER_API_KEY / ANTHROPIC_API_KEY).');
    } else {
      line('  Cumle verilmedi.');
    }
    line('  Hazir bir teklifle deterministik yari gosteriliyor:');
    line('  kural motoru + fiyat + denetim izi + onay ekrani.');
    line();
    line('  Dogal dil icin:');
    line('    npm run demo -- "Musteri 4 sunucu istiyor, load balancer olsun"');
    buildDemoEstimate(ctx.session);
  }

  const orchestrator = new Orchestrator({
    catalog,
    auditor: new Auditor(rules, llm),
    ...(useLlm && llm ? { extractor: new RequirementExtractor(llm), designer: new SolutionDesigner(llm) } : {}),
  });

  const result = await orchestrator.run(ctx, salesText, {
    onEvent: (event) => {
      if (event.stage === 'understand' || event.stage === 'design') line(`  … ${event.message}`);
    },

    onClarify: async (unknowns) => {
      title('1) TASARIMDAN ONCE NETLESTIRILMESI GEREKENLER');
      unknowns.forEach((u, i) => {
        line(`  ${i + 1}. ${u.question}`);
        line(`     neden kritik: ${u.reason}`);
      });
      line();
      line('  (demo: cevap verilmiyor, belirsiz birakiliyor)');
      return {};
    },

    onQuestions: async (questions, round) => {
      title(`2) SATISCIYA SORULAR — tur ${round}`);
      printQuestions(questions);
      line();
      line('  (demo: hicbiri cevaplanmiyor -> hepsi VARSAYIM olarak kaydedilecek)');
      return questions.map((q) => ({ ruleId: q.ruleId }));
    },

    onApprove: async (summary) => {
      title('3) ONAY EKRANI');
      line(renderApprovalScreen(summary));
      line();
      line('  (demo: onay VERILMIYOR — gercek teklif olusmaz)');
      return { approved: false };
    },
  });

  // --- sonuclar ------------------------------------------------------------

  if (result.spec) {
    title('ANLADIGIM (Requirement Extractor)');
    line(JSON.stringify(result.spec, null, 2).split('\n').map((l) => `  ${l}`).join('\n'));
  }

  if (result.draft) {
    title('TASARIM (Solution Designer)');
    for (const choice of result.draft.choices) {
      line(`  ${choice.service.padEnd(16)} ${choice.rationale}`);
    }
    line();
    line(`  Reddedilen tool cagrisi: ${result.draft.rejectedToolCalls}`);
    for (const r of result.draft.rejections) line(`    RED: ${r}`);
  }

  title('TEKLIFTEKI KALEMLER');
  const state = ctx.session.read();
  if (state.list.length === 0) {
    line('  (hic kalem yok)');
  } else {
    for (const item of state.list) {
      line(`  ${item.service}`);
      line(`    ${JSON.stringify(item.data)}`);
    }
  }

  if (result.audit) {
    title('DENETIM (Completeness Auditor)');
    line(`  ${result.audit.summary}`);
    line();
    const bySeverity = ['blocker', 'recommended', 'optional'] as const;
    for (const severity of bySeverity) {
      const gaps = result.audit.gaps.filter((g) => g.severity === severity);
      if (gaps.length === 0) continue;
      line(`  ${severity.toUpperCase()} (${gaps.length})`);
      for (const gap of gaps) line(`    [${gap.ruleId}] ${gap.message.replace(/\s+/g, ' ')}`);
      line();
    }
    for (const note of result.audit.contextualNotes) line(`  LLM gozlemi: ${note}`);
    line(`  Yayinlanabilir mi: ${result.audit.publishable ? 'EVET' : 'HAYIR (blocker var)'}`);
  }

  if (result.price && result.price.lines.length > 0) {
    title('FIYAT (deterministik motor — platformla bit-bit ayni)');
    printPrice(result.price);
  }

  if (result.assumptions.length > 0) {
    title('YAPILAN VARSAYIMLAR');
    for (const a of result.assumptions) line(`  ${a.question}\n    -> ${a.assumed}`);
  }

  title('AKIS SONUCU');
  line(`  Asama        : ${result.stage}`);
  line(`  Soru turu    : ${result.rounds}`);
  line(`  Yayinlandi   : ${result.published ? 'EVET' : 'HAYIR'}`);
  if (result.haltReason) line(`  Durma sebebi : ${result.haltReason}`);

  title('DENETIM IZI (Faz 7.B)');
  line(trail.render().split('\n').map((l) => `  ${l}`).join('\n'));

  if (spent > 0) {
    title('HARCAMA');
    line(`  Bu calistirma: $${spent.toFixed(4)}`);
  }
}

main().catch((error: unknown) => {
  console.error('\nHATA:', (error as Error).message);
  process.exitCode = 1;
});
