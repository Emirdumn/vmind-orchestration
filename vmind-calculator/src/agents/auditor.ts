/**
 * FAZ 5.C — Completeness Auditor
 *
 * PLAN'in notu: "Auditor'in kararlarinin cogu kural motorundan (deterministik)
 * gelir. LLM sadece kurallarin yakalayamadigi baglamsal bosluklar icin devreye
 * girer. Bu, halusinasyon yuzeyini minimuma indirir."
 *
 * Bu dosya o notu mimari olarak zorlar:
 *   - Gap listesi ve publishable karari TAMAMEN kural motorundan gelir
 *   - LLM yalnizca `contextualNotes` uretebilir; Gap ekleyemez, silemez,
 *     severity degistiremez
 *   - LLM cagrisi basarisiz olursa denetim yine de tamamlanir (degraded degil,
 *     sadece baglamsal not olmadan)
 */
import type { RuleEngine } from '../core/rules/engine.js';
import { buildReport, type Gap, type ValidationReport } from '../core/rules/types.js';
import type { Currency, ServiceCode } from '../core/schema/estimate.js';
import type { LlmClient } from './llm.js';
import { AUDITOR_SYSTEM } from './prompts.js';
import { networkPolicyGaps } from './network-policy.js';
import type { AuditQuestion, AuditReport, RequirementSpec } from './types.js';
import { vmindRecommendedAuditAnswer } from './vmind-defaults.js';

/** PLAN 6.A: tek turda en fazla 5 soru. */
export const MAX_QUESTIONS_PER_ROUND = 5;

export interface AuditInput {
  currency: Currency;
  list: Array<{ id: string; service: ServiceCode; data: Record<string, unknown> }>;
  /** Varsa Requirement Extractor ciktisi — baglamsal gozlem icin. */
  spec?: RequirementSpec;
  /** Daha once sorulup cevaplanmis (veya atlanmis) kural id'leri. */
  answeredRuleIds?: ReadonlySet<string>;
}

/**
 * Sorulari onceliklendirir: once blocker, sonra recommended.
 * `optional` ASLA sorulmaz — yalnizca raporda listelenir (PLAN 4.B).
 */
export function prioritizeQuestions(
  gaps: readonly Gap[],
  answered: ReadonlySet<string> = new Set(),
): AuditQuestion[] {
  const askable = gaps.filter(
    (gap) => gap.ask !== undefined && gap.severity !== 'optional' && !answered.has(gap.ruleId),
  );

  // Ayni kural birden fazla kalemde tetiklenmis olabilir; soru bir kez sorulur.
  const seen = new Set<string>();
  const unique: Gap[] = [];
  for (const gap of askable) {
    if (seen.has(gap.ruleId)) continue;
    seen.add(gap.ruleId);
    unique.push(gap);
  }

  const bySeverity = [...unique].sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'blocker' ? -1 : 1;
  });

  return bySeverity.slice(0, MAX_QUESTIONS_PER_ROUND).map((gap) => ({
    ruleId: gap.ruleId,
    question: gap.ask!,
    // PLAN 6.A: satisci tum sorulari atlayabilmeli -> her sorunun varsayilani olmali.
    defaultAnswer: vmindRecommendedAuditAnswer(
      gap.ruleId,
      gap.default ?? 'Varsayilan tanimlanmamis',
    ),
    severity: gap.severity,
    ...(gap.itemId !== undefined ? { itemId: gap.itemId } : {}),
  }));
}

/** LLM olmadan da calisan Turkce ozet. */
export function buildSummary(report: ValidationReport): string {
  if (report.gaps.length === 0) {
    return 'Denetim temiz: teklifte eksik veya tutarsiz kalem bulunamadi.';
  }
  const parts: string[] = [];
  if (report.blockers.length > 0) {
    parts.push(
      `${report.blockers.length} kritik eksik var; bunlar cozulmeden teklif yayinlanamaz.`,
    );
  }
  if (report.recommended.length > 0) {
    parts.push(`${report.recommended.length} onerilen duzeltme var.`);
  }
  if (report.optional.length > 0) {
    parts.push(`${report.optional.length} ek satis firsati listelendi.`);
  }
  return parts.join(' ');
}

export class Auditor {
  constructor(
    private readonly rules: RuleEngine,
    private readonly llm?: LlmClient,
  ) {}

  /**
   * Denetimi calistirir.
   *
   * `llm` verilmemisse veya cagri basarisiz olursa denetim YINE tamamlanir;
   * yalnizca `contextualNotes` bos kalir. Kural tarafi hicbir kosulda atlanmaz.
   */
  async audit(input: AuditInput): Promise<AuditReport> {
    const ruleReport = this.rules.check({ currency: input.currency, list: input.list });
    const report = buildReport([
      ...ruleReport.gaps,
      ...networkPolicyGaps(input.spec, input.list),
    ]);
    const questions = prioritizeQuestions(report.gaps, input.answeredRuleIds ?? new Set());

    const contextualNotes = await this.contextualNotes(input, report);

    return {
      gaps: report.gaps,
      questions,
      summary: buildSummary(report),
      publishable: report.publishable,
      contextualNotes,
    };
  }

  private async contextualNotes(input: AuditInput, report: ValidationReport): Promise<string[]> {
    if (!this.llm) return [];
    try {
      const text = await this.llm.text({
        system: AUDITOR_SYSTEM,
        userMessage: [
          'Teklif kalemleri:',
          JSON.stringify(input.list, null, 1),
          '',
          'Kural motorunun buldugu eksikler:',
          JSON.stringify(
            report.gaps.map((g) => ({ id: g.ruleId, severity: g.severity, message: g.message })),
            null,
            1,
          ),
          '',
          input.spec ? `Satiscinin anlatimindan cikarilan ihtiyac:\n${JSON.stringify(input.spec, null, 1)}` : '',
          '',
          'Kural motorunun YAKALAYAMADIGI baglamsal gozlemlerin varsa her birini',
          'ayri satirda, tire ile baslayarak yaz. Gozlemin yoksa sadece "yok" yaz.',
        ].join('\n'),
        maxTokens: 1000,
      });

      if (text.trim().toLowerCase() === 'yok') return [];
      return text
        .split('\n')
        .map((line) => line.replace(/^[-*•]\s*/, '').trim())
        .filter((line) => line.length > 0 && line.toLowerCase() !== 'yok');
    } catch {
      // Baglamsal not "nice to have"; denetimin kendisi deterministik tarafta tamamlandi.
      return [];
    }
  }
}
