/**
 * FAZ 5.A / 5.B eval harness — GERCEK LLM gerektirir.
 *
 *   npm run eval            # her ikisi
 *   npm run eval extract    # yalnizca 5.A
 *   npm run eval design     # yalnizca 5.B
 *
 * OPENROUTER_API_KEY veya ANTHROPIC_API_KEY gerekir (hangisi tanimliysa o
 * kullanilir; ikisi de varsa OpenRouter oncelikli). Anahtar yoksa script
 * anlamli bir mesajla cikar — deterministik testler bundan etkilenmez.
 *
 * DIKKAT: bu anahtar VMind API anahtarindan FARKLIDIR. VMind katalog/fiyat
 * icin, bu anahtar dogal dili anlayan model icin.
 *
 * Kabul kriterleri (PLAN):
 *   5.A: 10 senaryonun >= 9'u tum kontrolleri gecmeli
 *   5.B: 10 senaryoda toplam reddedilme sayisi ~0, hic uydurma productCode yok
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext } from '../src/mcp/tools/index.js';
import { MissingCredentialsError, createLlm, type LlmClient } from '../src/agents/llm.js';
import { RequirementExtractor } from '../src/agents/extractor.js';
import { SolutionDesigner } from '../src/agents/designer.js';
import { DESIGN_CASES, EXTRACTION_CASES } from './scenarios.js';
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

/**
 * EVAL_LIMIT ile senaryo sayisi kisitlanabilir — ucuz duman testi icin.
 * Kabul kriteri ancak TAM set ile olculur; kisitli calistirma "boru hatti
 * calisiyor mu" sorusunu yanitlar, "model yeterince iyi mi" sorusunu degil.
 */
const limit = Number(process.env['EVAL_LIMIT']) || 0;
const applyLimit = <T>(cases: T[]): T[] => (limit > 0 ? cases.slice(0, limit) : cases);
const isPartial = (): boolean => limit > 0;

/**
 * BUTCE FRENI — EVAL_BUDGET_USD.
 *
 * Neden gerekli: eval 20 LLM cagrisi yapar ve her cagrinin maliyeti girdi
 * boyutuna gore degisir. Fren olmadan "biraz deneyelim" bir anda kredinin
 * tamamini yiyebilir. Bu sinif her senaryodan ONCE kontrol eder ve asilmissa
 * kalan senaryolari HIC CALISTIRMAZ — asildiktan sonra durmak yetmez.
 *
 * Maliyet TAHMIN EDILMIYOR: OpenRouter'in bildirdigi `usage.cost` kullaniliyor.
 * Saglayici maliyet bildirmezse (Anthropic) fren token sayar ve bunu soyler.
 */
class BudgetGuard {
  private spentUsd = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;
  private costReported = false;

  constructor(readonly limitUsd: number) {}

  record(usage: { inputTokens: number; outputTokens: number; costUsd?: number }): void {
    this.calls++;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    if (usage.costUsd !== undefined) {
      this.spentUsd += usage.costUsd;
      this.costReported = true;
    }
  }

  /** Bir sonraki senaryoya girmeden once cagrilir. */
  exceeded(): boolean {
    return this.limitUsd > 0 && this.costReported && this.spentUsd >= this.limitUsd;
  }

  report(): string {
    const cost = this.costReported ? `$${this.spentUsd.toFixed(4)}` : '(saglayici bildirmedi)';
    const perCall = this.costReported && this.calls > 0 ? `, ortalama $${(this.spentUsd / this.calls).toFixed(4)}/cagri` : '';
    return `${this.calls} LLM cagrisi | ${this.inputTokens}+${this.outputTokens} token | harcanan ${cost}${perCall}`;
  }

  get spent(): number {
    return this.spentUsd;
  }
  get callCount(): number {
    return this.calls;
  }
  get hasCost(): boolean {
    return this.costReported;
  }
}

const budgetLimit = Number(process.env['EVAL_BUDGET_USD']) || 0;
const budget = new BudgetGuard(budgetLimit);

async function runExtractionEval(llm: LlmClient): Promise<boolean> {
  console.log('\n=== FAZ 5.A — Requirement Extractor ===\n');
  const extractor = new RequirementExtractor(llm);
  let passed = 0;
  const cases = applyLimit(EXTRACTION_CASES);

  for (const testCase of cases) {
    if (budget.exceeded()) {
      console.log(`  ATLANDI (butce) — kalan senaryolar calistirilmadi: ${budget.report()}`);
      break;
    }
    try {
      const spec = await extractor.extract(testCase.text);
      const failures = testCase.checks.filter((check) => !check.assert(spec));
      if (failures.length === 0) {
        passed++;
        console.log(`  GECTI  ${testCase.name}`);
      } else {
        console.log(`  KALDI  ${testCase.name}`);
        for (const failure of failures) console.log(`         - ${failure.label}`);
        console.log(`         spec: ${JSON.stringify(spec)}`);
      }
    } catch (error) {
      console.log(`  HATA   ${testCase.name}: ${(error as Error).message}`);
    }
  }

  const target = Math.ceil(cases.length * 0.9);
  console.log(`\n  Sonuc: ${passed}/${cases.length} (hedef >= ${target})`);
  if (isPartial()) {
    console.log(`  DIKKAT: EVAL_LIMIT=${limit} — kismi calistirma, kabul kriteri OLCULMEDI.`);
  }
  return passed >= target;
}

async function runDesignEval(llm: LlmClient): Promise<boolean> {
  console.log('\n=== FAZ 5.B — Solution Designer ===\n');
  const designer = new SolutionDesigner(llm);
  let totalRejections = 0;
  let fabricatedCodes = 0;
  let servicesMatched = 0;

  const cases = applyLimit(DESIGN_CASES);

  for (const testCase of cases) {
    if (budget.exceeded()) {
      console.log(`  ATLANDI (butce) — kalan senaryolar calistirilmadi: ${budget.report()}`);
      break;
    }
    const ctx = createToolContext(catalog, rules, {
      session: new EstimateSession(catalog, { currency: 'TL' }),
    });
    try {
      const draft = await designer.design(ctx, testCase.spec);
      totalRejections += draft.rejectedToolCalls;
      const fabricated = draft.rejections.filter((r) => r.includes('UnknownProductCodeError')).length;
      fabricatedCodes += fabricated;

      const items = ctx.session.read().list;
      const services = new Set<string>(items.map((item) => item.service));
      const missing = testCase.expectedServices.filter((service) => !services.has(service));
      if (missing.length === 0) servicesMatched++;

      const status = missing.length === 0 ? 'GECTI ' : 'KALDI ';
      console.log(
        `  ${status} ${testCase.name} — ${items.length} kalem, ` +
          `${draft.rejectedToolCalls} red (${fabricated} uydurma kod)`,
      );
      // TESHIS: hangi kalemler eklendi. "eksik servis" mesaji tek basina
      // yetersizdi — neyin EKLENDIGINI gormeden neden eksik oldugu anlasilmaz.
      console.log(`         beklenen: [${testCase.expectedServices.join(', ')}]`);
      console.log(
        `         eklenen : [${items.map((i) => i.service).join(', ') || '(hic)'}]` +
          (missing.length > 0 ? `   EKSIK: ${missing.join(', ')}` : ''),
      );
      for (const item of items) {
        const data = item.data as Record<string, unknown>;
        const fields = Object.keys(data).filter((k) => data[k] !== undefined);
        console.log(`           ${item.service}: {${fields.join(', ')}}`);
      }
      for (const rejection of draft.rejections) console.log(`         RED: ${rejection}`);
      // Kalem eklenmediyse ajanin GEREKCESI gerekli — yoksa neden eklemedigi
      // tahmine kalir. Teshis icin ozet metni basiliyor.
      if (missing.length > 0 && draft.finalText) {
        console.log(`         ajanin ozeti: ${draft.finalText.replace(/\s+/g, ' ').slice(0, 400)}`);
      }
    } catch (error) {
      console.log(`  HATA   ${testCase.name}: ${(error as Error).message}`);
    }
  }

  console.log(`\n  Kalem seti dogru: ${servicesMatched}/${cases.length}`);
  console.log(`  Toplam reddedilme: ${totalRejections}`);
  console.log(`  Uydurma productCode denemesi: ${fabricatedCodes} (hedef: 0)`);
  if (isPartial()) {
    console.log(`  DIKKAT: EVAL_LIMIT=${limit} — kismi calistirma, kabul kriteri OLCULMEDI.`);
  }
  return fabricatedCodes === 0;
}

async function main(): Promise<void> {
  let llm: LlmClient;
  try {
    // Kullanim sinyali butce frenine baglanir; her cagri sonrasi maliyet birikir.
    const selection = createLlm({ onUsage: (u) => budget.record(u) });
    llm = selection.client;
    console.log(`Saglayici: ${selection.provider}  |  Model: ${selection.model}`);
    console.log(
      `Butce sinirı: ${budgetLimit > 0 ? `$${budgetLimit.toFixed(2)}` : '(YOK — EVAL_BUDGET_USD tanimlayin)'}` +
        `  |  Senaryo siniri: ${limit > 0 ? limit : 'tam set'}`,
    );
    if (budgetLimit === 0) {
      console.log('  UYARI: butce freni kapali. Kredi tukenebilir.');
    }
  } catch (error) {
    if (error instanceof MissingCredentialsError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const which = process.argv[2];

  let ok = true;
  if (!which || which === 'extract') ok = (await runExtractionEval(llm)) && ok;
  if (!which || which === 'design') ok = (await runDesignEval(llm)) && ok;

  console.log('\n=== HARCAMA ===');
  console.log(`  ${budget.report()}`);
  if (budget.hasCost && budget.callCount > 0) {
    const perCall = budget.spent / budget.callCount;
    const fullRun = perCall * (EXTRACTION_CASES.length + DESIGN_CASES.length * 5);
    console.log(`  Tam set tahmini (20 senaryo, tasarimda ~5 tur/senaryo): ~$${fullRun.toFixed(2)}`);
  }

  console.log(ok ? '\nKABUL KRITERLERI SAGLANDI.\n' : '\nKABUL KRITERLERI SAGLANMADI.\n');
  process.exitCode = ok ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
