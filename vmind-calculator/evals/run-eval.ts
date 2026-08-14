/**
 * Gerçek model eval'i. İnsan okunur çıktı yanında makine okunur JSON üretir.
 *
 *   EVAL_BUDGET_USD=1 npm run eval
 *   npm run eval -- extract --report=var/evals/extract.json
 *   EVAL_LIMIT=2 EVAL_BUDGET_USD=.20 npm run eval -- design
 *
 * Kısmi koşu boru hattını doğrular; tam kabul sayılmaz. Tasarım kabulü artık
 * yalnız "uydurma kod yok" değildir: beklenen servislerin en az %90'ı gerçekten
 * oluşmalı ve hiçbir reddedilmiş/uydurulmuş tool çağrısı kalmamalıdır.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext } from '../src/mcp/tools/index.js';
import { MissingCredentialsError, createLlm, type LlmClient } from '../src/agents/llm.js';
import {
  RoutedLlm,
  modelRouterConfigFromEnv,
  type ModelRouteDecision,
} from '../src/agents/model-router.js';
import { RequirementExtractor } from '../src/agents/extractor.js';
import { SolutionDesigner } from '../src/agents/designer.js';
import { DESIGN_CASES, EXTRACTION_CASES } from './scenarios.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));
const catalog = Catalog.fromEnvelopes(
  read<Product>('products.json'), read<Flavor>('flavors.json'), read<VolumeType>('volume-types.json'),
);
const rules = RuleEngine.fromYaml(
  readFileSync(join(root, 'rules', 'estimate-rules.yaml'), 'utf8'), catalog,
);

const limit = Number(process.env['EVAL_LIMIT']) || 0;
const applyLimit = <T>(cases: T[]): T[] => (limit > 0 ? cases.slice(0, limit) : cases);
const partial = limit > 0;

interface CaseResult {
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped-budget';
  latencyMs: number;
  failures: string[];
  detail?: Record<string, unknown>;
}

interface SuiteResult {
  suite: 'extract' | 'design';
  passed: number;
  executed: number;
  total: number;
  targetPassed: number;
  ok: boolean;
  cases: CaseResult[];
  metrics?: Record<string, number>;
}

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

  exceeded(): boolean {
    return this.limitUsd > 0 && this.costReported && this.spentUsd >= this.limitUsd;
  }

  snapshot(): Record<string, number | boolean | null> {
    return {
      limitUsd: this.limitUsd,
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costReported: this.costReported,
      spentUsd: this.costReported ? this.spentUsd : null,
      averageCostUsd: this.costReported && this.calls > 0 ? this.spentUsd / this.calls : null,
    };
  }

  report(): string {
    const cost = this.costReported ? `$${this.spentUsd.toFixed(4)}` : '(sağlayıcı bildirmedi)';
    return `${this.calls} çağrı | ${this.inputTokens}+${this.outputTokens} token | ${cost}`;
  }
}

const budgetLimit = Number(process.env['EVAL_BUDGET_USD']) || 0;
const budget = new BudgetGuard(budgetLimit);

async function runExtractionEval(llm: LlmClient): Promise<SuiteResult> {
  console.log('\n=== Requirement Extractor ===\n');
  const extractor = new RequirementExtractor(llm);
  const cases = applyLimit(EXTRACTION_CASES);
  const results: CaseResult[] = [];
  let passed = 0;
  let executed = 0;

  for (const testCase of cases) {
    if (budget.exceeded()) {
      results.push({ name: testCase.name, status: 'skipped-budget', latencyMs: 0, failures: ['Eval bütçesi aşıldı.'] });
      console.log(`  ATLANDI ${testCase.name} — bütçe`);
      continue;
    }
    const started = performance.now();
    executed++;
    try {
      const spec = await extractor.extract(testCase.text);
      const failures = testCase.checks.filter((check) => !check.assert(spec)).map((check) => check.label);
      if (failures.length === 0) passed++;
      results.push({
        name: testCase.name,
        status: failures.length === 0 ? 'passed' : 'failed',
        latencyMs: Math.round(performance.now() - started),
        failures,
        detail: { unknownCount: spec.unknowns.length },
      });
      console.log(`  ${failures.length === 0 ? 'GEÇTİ ' : 'KALDI '} ${testCase.name}`);
      failures.forEach((failure) => console.log(`         - ${failure}`));
    } catch (error) {
      results.push({
        name: testCase.name, status: 'error',
        latencyMs: Math.round(performance.now() - started),
        failures: [error instanceof Error ? error.message : String(error)],
      });
      console.log(`  HATA   ${testCase.name}`);
    }
  }
  const targetPassed = Math.ceil(cases.length * 0.9);
  const ok = executed === cases.length && passed >= targetPassed;
  console.log(`\n  Sonuç: ${passed}/${cases.length} (hedef >= ${targetPassed})`);
  return { suite: 'extract', passed, executed, total: cases.length, targetPassed, ok, cases: results };
}

async function runDesignEval(llm: LlmClient): Promise<SuiteResult> {
  console.log('\n=== Solution Designer ===\n');
  const designer = new SolutionDesigner(llm);
  const cases = applyLimit(DESIGN_CASES);
  const results: CaseResult[] = [];
  let passed = 0;
  let executed = 0;
  let totalRejections = 0;
  let fabricatedCodes = 0;

  for (const testCase of cases) {
    if (budget.exceeded()) {
      results.push({ name: testCase.name, status: 'skipped-budget', latencyMs: 0, failures: ['Eval bütçesi aşıldı.'] });
      console.log(`  ATLANDI ${testCase.name} — bütçe`);
      continue;
    }
    const started = performance.now();
    executed++;
    const ctx = createToolContext(catalog, rules, {
      session: new EstimateSession(catalog, { currency: 'TL' }),
    });
    try {
      const draft = await designer.design(ctx, testCase.spec);
      totalRejections += draft.rejectedToolCalls;
      const fabricated = draft.rejections.filter((entry) => entry.includes('UnknownProductCodeError')).length;
      fabricatedCodes += fabricated;
      const items = ctx.session.read().list;
      const services = [...new Set(items.map((item) => item.service))];
      const missing = testCase.expectedServices.filter((service) => !services.includes(service as never));
      const failures = [
        ...missing.map((service) => `Eksik servis: ${service}`),
        ...(fabricated > 0 ? [`${fabricated} uydurma productCode`] : []),
        ...(draft.rejectedToolCalls > 0 ? [`${draft.rejectedToolCalls} reddedilmiş tool çağrısı`] : []),
      ];
      if (failures.length === 0) passed++;
      results.push({
        name: testCase.name,
        status: failures.length === 0 ? 'passed' : 'failed',
        latencyMs: Math.round(performance.now() - started), failures,
        detail: { expectedServices: testCase.expectedServices, actualServices: services, itemCount: items.length },
      });
      console.log(
        `  ${failures.length === 0 ? 'GEÇTİ ' : 'KALDI '} ${testCase.name} — ` +
          `[${services.join(', ') || 'boş'}], red=${draft.rejectedToolCalls}, uydurma=${fabricated}`,
      );
    } catch (error) {
      results.push({
        name: testCase.name, status: 'error',
        latencyMs: Math.round(performance.now() - started),
        failures: [error instanceof Error ? error.message : String(error)],
      });
      console.log(`  HATA   ${testCase.name}`);
    }
  }

  const targetPassed = Math.ceil(cases.length * 0.9);
  const ok =
    executed === cases.length && passed >= targetPassed && fabricatedCodes === 0 && totalRejections === 0;
  console.log(`\n  Tam doğru: ${passed}/${cases.length} (hedef >= ${targetPassed})`);
  console.log(`  Reddedilmiş tool: ${totalRejections}; uydurma kod: ${fabricatedCodes}`);
  return {
    suite: 'design', passed, executed, total: cases.length, targetPassed, ok, cases: results,
    metrics: { totalRejections, fabricatedCodes },
  };
}

function routeCounts(decisions: ModelRouteDecision[]): Record<string, number> {
  return decisions.reduce<Record<string, number>>((counts, decision) => {
    counts[decision.tier] = (counts[decision.tier] ?? 0) + 1;
    return counts;
  }, { fast: 0, balanced: 0, strong: 0 });
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const args = process.argv.slice(2);
  const which = args.find((arg) => !arg.startsWith('--'));
  if (which && !['extract', 'design'].includes(which)) {
    throw new Error('Eval modu yalnız extract veya design olabilir.');
  }
  const requestedOutput = args.find((arg) => arg.startsWith('--report='))?.slice('--report='.length)
    || process.env['EVAL_REPORT_FILE'];
  const defaultName = `eval-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`;
  const reportPath = resolve(requestedOutput || join(root, 'var', 'evals', defaultName));
  const decisions: ModelRouteDecision[] = [];
  const suites: SuiteResult[] = [];
  let provider: string | null = null;
  let models: Record<string, string> | null = null;
  let fatalError: string | null = null;

  try {
    const probe = createLlm({ onUsage: () => {} });
    provider = probe.provider;
    const routerConfig = modelRouterConfigFromEnv(probe.provider);
    models = {
      fast: routerConfig.fastModel,
      balanced: routerConfig.balancedModel,
      strong: routerConfig.strongModel,
    };
    const llm = new RoutedLlm(routerConfig, (decision) => {
      decisions.push(decision);
      return createLlm({ model: decision.model, onUsage: (usage) => budget.record(usage) }).client;
    });
    console.log(`Sağlayıcı: ${provider} | Router: ${JSON.stringify(models)}`);
    console.log(`Bütçe: ${budgetLimit > 0 ? `$${budgetLimit.toFixed(2)}` : 'KAPALI'}`);
    if (!which || which === 'extract') suites.push(await runExtractionEval(llm));
    if (!which || which === 'design') suites.push(await runDesignEval(llm));
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
    if (error instanceof MissingCredentialsError) console.error(error.message);
    else console.error(error);
  }

  const acceptanceMeasured = !partial && fatalError === null && suites.every((suite) => suite.executed === suite.total);
  const ok = fatalError === null && suites.length > 0 && suites.every((suite) => suite.ok);
  const completedAt = new Date();
  const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    mode: which ?? 'all', partial, acceptanceMeasured, ok,
    provider, models, routeCounts: routeCounts(decisions), routeDecisions: decisions,
    budget: budget.snapshot(), suites, fatalError,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nJSON raporu: ${reportPath}`);
  console.log(`Harcama: ${budget.report()}`);
  console.log(ok ? '\nEVAL KOŞUSU GEÇTİ.\n' : '\nEVAL KOŞUSU KALDI.\n');
  process.exitCode = ok ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
