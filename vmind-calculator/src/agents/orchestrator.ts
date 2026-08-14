/**
 * FAZ 5.C — Orchestrator
 *
 * Akis: Anla -> Tasarla -> Denetle -> Sor -> Duzelt -> Onay -> Yayinla
 *
 * BU DOSYADA LLM YOK. Akis kontrolu, tur sayaci ve HITL kapisi deterministik
 * olmak zorunda: "kac tur soru soruldu" veya "onay alindi mi" sorularinin
 * cevabi olasiliksal olamaz. LLM yalnizca alt ajanlarin ICINDE calisir.
 *
 * Diger ajanlar stateless kalsin diye tum durum burada tutulur.
 */
import type { Catalog } from '../core/catalog/catalog.js';
import type { EstimateSession, EstimateState } from '../core/estimate/session.js';
import { approvalTools, priceTools, publishTools, type ToolContext } from '../mcp/tools/index.js';
import type { Auditor } from './auditor.js';
import type { RequirementExtractor } from './extractor.js';
import { criticalUnknowns, hasServiceIntent } from './extractor.js';
import { deriveMonthlyEgress, normalizeNetworkTopology } from './network-units.js';
import type { SolutionDesigner } from './designer.js';
import { parseRemoteEstimate, reconcile } from './reconciler.js';
import type {
  AuditQuestion,
  AuditReport,
  CriticalUnknown,
  EstimateDraft,
  PriceSnapshot,
  ReconcileResult,
  RequirementSpec,
} from './types.js';
import {
  applyVmindStrongProfile,
  resolveAuditAnswer,
  resolveClarificationAnswers,
} from './vmind-defaults.js';
import { reconcileBackupItems } from './backup-reconciler.js';

/** PLAN 5.C kabul kriteri: sonsuz soru-cevap dongusu yok. */
export const MAX_AUDIT_ROUNDS = 3;

export type FlowStage =
  | 'understand'
  | 'clarify'
  | 'design'
  | 'audit'
  | 'ask'
  | 'revise'
  | 'reconcile'
  | 'approve'
  | 'publish'
  | 'crm'
  | 'done'
  | 'halted';

export interface FlowEvent {
  stage: FlowStage;
  message: string;
  data?: unknown;
}

/** Satiscinin bir soruya verdigi cevap. Bos birakilirsa varsayilan kullanilir. */
export interface QuestionAnswer {
  ruleId: string;
  /** undefined veya bos => varsayilan uygulanir ve raporda "varsayim" olarak yazilir. */
  answer?: string;
}

export interface AssumptionRecord {
  ruleId: string;
  question: string;
  assumed: string;
}

export interface OrchestratorCallbacks {
  /** Tasarima gecmeden once sorulan kritik netlestirme sorusu. */
  onClarify?: (unknowns: CriticalUnknown[]) => Promise<Record<string, string>>;
  /** Denetim sorulari — satisci hepsini atlayabilir. */
  onQuestions?: (questions: AuditQuestion[], round: number) => Promise<QuestionAnswer[]>;
  /** Cevaplara gore taslagi guncelleme sansi (LLM'li veya elle). */
  onRevise?: (
    answers: QuestionAnswer[],
    ctx: ToolContext,
  ) => Promise<void | { unresolvedRuleIds?: string[] }>;
  /** Onay ekrani. false donerse yayinlanmaz. */
  onApprove?: (summary: PublishSummary) => Promise<{ approved: boolean; approvedBy?: string }>;
  /** Akis olaylarini izlemek icin (loglama / UI). */
  onEvent?: (event: FlowEvent) => void;
}

export interface PublishSummary {
  price: PriceSnapshot;
  audit: AuditReport;
  assumptions: AssumptionRecord[];
  /** Onay editorunun gosterecegi ve itemId ile duzenleyecegi guncel taslak. */
  estimate: EstimateState;
  spec?: RequirementSpec;
  draft?: EstimateDraft;
}

export interface FlowResult {
  stage: FlowStage;
  spec?: RequirementSpec;
  draft?: EstimateDraft;
  audit?: AuditReport;
  price?: PriceSnapshot;
  reconcile?: ReconcileResult;
  assumptions: AssumptionRecord[];
  rounds: number;
  published: boolean;
  shareUrl?: string;
  /** Akis durduysa nedeni. */
  haltReason?: string;
  events: FlowEvent[];
}

export interface OrchestratorDeps {
  catalog: Catalog;
  auditor: Auditor;
  extractor?: RequirementExtractor;
  designer?: SolutionDesigner;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Tam akisi calistirir.
   *
   * `extractor` / `designer` verilmemisse (LLM yoksa) akis, ctx.session icinde
   * ONCEDEN kurulmus bir teklifle `audit` asamasindan devam eder. Bu, denetim,
   * soru turu, mutabakat ve HITL kapisinin LLM olmadan test edilmesini saglar.
   */
  async run(
    ctx: ToolContext,
    salesText: string,
    callbacks: OrchestratorCallbacks = {},
  ): Promise<FlowResult> {
    const events: FlowEvent[] = [];
    const assumptions: AssumptionRecord[] = [];
    // `trail` (denetim izi) ile `audit` (Auditor'in raporu) ayri seylerdir;
    // isim karismasin diye bilerek farkli adlandirildi.
    const trail = ctx.audit;

    const emit = (stage: FlowStage, message: string, data?: unknown): void => {
      const event: FlowEvent = { stage, message, ...(data !== undefined ? { data } : {}) };
      events.push(event);
      // FAZ 7.B: her asama gecisi denetim izine yazilir.
      trail?.stage(stage, message);
      callbacks.onEvent?.(event);
    };

    // Satisci metni prompt'a gitmeden PII taramasindan gecer. Tarama BLOKE
    // ETMEZ — musteri adi/telefonu tekliften silinemez; ize "biliyorduk" kaydi
    // dusmesi yeterli, boylece sonradan hangi teklifte PII islendigi bulunabilir.
    trail?.scanText('satisci metni', salesText);

    const halt = (reason: string, partial: Partial<FlowResult> = {}): FlowResult => {
      emit('halted', reason);
      trail?.halt(reason);
      return {
        stage: 'halted',
        assumptions,
        rounds: 0,
        published: false,
        haltReason: reason,
        events,
        ...partial,
      };
    };

    // --- 1. ANLA ---------------------------------------------------------
    let spec: RequirementSpec | undefined;
    let clarifications: Record<string, string> = {};
    let strongProfileActivated = false;
    if (this.deps.extractor) {
      emit('understand', 'Satisci metni yapisal ihtiyaca cevriliyor.');
      spec = await this.deps.extractor.extract(salesText);
      emit('understand', `Ihtiyac cikarildi. ${spec.unknowns.length} belirsizlik var.`, spec);
      const needsDiscovery = !hasServiceIntent(spec);

      // --- 2. NETLESTIR (tasarimdan ONCE) --------------------------------
      const critical = criticalUnknowns(spec);
      if (critical.length > 0) {
        emit('clarify', `${critical.length} kritik belirsizlik tasarimdan once soruluyor.`, critical);
        if (callbacks.onClarify) {
          const rawAnswers = await callbacks.onClarify(critical);
          const resolved = resolveClarificationAnswers(
            critical,
            rawAnswers,
            spec.networkExposure,
          );
          clarifications = resolved.answers;
          for (const applied of resolved.defaults) {
            assumptions.push({
              ruleId: 'VMIND_STRONG_DEFAULT',
              question: applied.question,
              assumed: applied.answer,
            });
            trail?.assumption('VMIND_STRONG_DEFAULT', applied.question, applied.answer);
          }
          if (resolved.defaults.length > 0) {
            strongProfileActivated = true;
            emit(
              'clarify',
              `${resolved.defaults.length} boş, belirsiz veya ilgisiz cevaba VMind güçlü varsayılanı uygulandı.`,
              resolved.defaults,
            );
          }
          spec = {
            ...spec,
            // Bos birakilan soru cozulmus sayilmaz. Onceki kod, form alani
            // gonderildigi anda bos cevabi bile unknowns'tan siliyordu.
            unknowns: spec.unknowns.filter((unknown) => !(unknown in clarifications)),
            rationale: `${spec.rationale}\nNetlestirme: ${JSON.stringify(clarifications)}`,
          };

          // Netlestirme cevaplarini her zaman yeniden yapisal semaya sok.
          // Yalnizca serbest metin olarak Designer'a birakmak; "public", App LB,
          // Floating IP ve outbound miktarinin farkli kalemlere dagilmasina veya
          // hic uygulanmamasina yol aciyordu.
          if (Object.keys(clarifications).length > 0) {
            spec = await this.deps.extractor.extract(
              [
                salesText,
                '',
                'Satiscinin mimari kesif cevaplari:',
                ...Object.entries(clarifications).map(
                  ([question, answer]) => `- ${question} -> ${answer}`,
                ),
              ].join('\n'),
            );
            emit(
              'understand',
              needsDiscovery
                ? 'Kesif cevaplari yapisal ihtiyaca islendi.'
                : 'Netlestirme cevaplari yapisal ihtiyaca islendi.',
              spec,
            );
          }

          // Mbps bir hizdir, aylik GB degildir. Kullanim yuzdesi cevaplandiysa
          // donusumu deterministik yap; Designer'a aritmetik/24x7 varsayimi birakma.
          spec = normalizeNetworkTopology(
            deriveMonthlyEgress(spec, Object.values(clarifications)),
          );
        }
      }
    }

    // --- 3. TASARLA ------------------------------------------------------
    let draft: EstimateDraft | undefined;
    if (this.deps.designer && spec) {
      emit('design', 'Katalogdan urunler seciliyor.');
      draft = await this.deps.designer.design(ctx, spec, clarifications);
      if (strongProfileActivated) {
        const strongProfile = await applyVmindStrongProfile(
          ctx,
          spec,
          [salesText, ...Object.values(clarifications)].join('\n'),
        );
        if (strongProfile.changed) {
          emit(
            'design',
            `VMind güçlü profil koruması uygulandı: ${strongProfile.actions.join(' ')}`,
            strongProfile,
          );
        }
      }
      emit(
        'design',
        `${draft.choices.length} kalem eklendi, ${draft.rejectedToolCalls} tool cagrisi reddedildi.`,
        draft,
      );
    }

    const backupReconcile = await reconcileBackupItems(ctx);
    if (backupReconcile.changed) emit('design', backupReconcile.message, backupReconcile);

    if (ctx.session.itemCount === 0) {
      return halt('Teklifte hic kalem yok — tasarim asamasi sonuc uretmedi.', {
        ...(spec ? { spec } : {}),
        ...(draft ? { draft } : {}),
      });
    }

    // --- 4-6. DENETLE -> SOR -> DUZELT (en fazla MAX_AUDIT_ROUNDS tur) ----
    const answeredRuleIds = new Set<string>();
    let audit: AuditReport | undefined;
    let rounds = 0;

    for (; rounds < MAX_AUDIT_ROUNDS; rounds++) {
      const state = ctx.session.read();
      audit = await this.deps.auditor.audit({
        currency: state.currency,
        list: state.list,
        ...(spec ? { spec } : {}),
        answeredRuleIds,
      });
      emit('audit', audit.summary, audit);
      ctx.audit?.validation({
        gapCount: audit.gaps.length,
        blockerCount: audit.gaps.filter((g) => g.severity === 'blocker').length,
        publishable: audit.publishable,
        ruleIds: audit.gaps.map((g) => g.ruleId),
      });

      if (audit.questions.length === 0) break;

      if (!callbacks.onQuestions) {
        // Soru sorulamiyorsa varsayilanlar uygulanmis sayilir ve KAYDEDILIR.
        for (const question of audit.questions) {
          assumptions.push({
            ruleId: question.ruleId,
            question: question.question,
            assumed: question.defaultAnswer,
          });
          trail?.assumption(question.ruleId, question.question, question.defaultAnswer);
          answeredRuleIds.add(question.ruleId);
        }
        emit('ask', `${audit.questions.length} soru varsayilanlarla gecildi.`);
        break;
      }

      emit('ask', `Tur ${rounds + 1}: ${audit.questions.length} soru soruluyor.`, audit.questions);
      for (const question of audit.questions) {
        trail?.questionAsked(question.ruleId, question.question, rounds + 1);
      }
      const answers = await callbacks.onQuestions(audit.questions, rounds + 1);

      const resolvedAnswers = new Map(
        audit.questions.map((question) => {
          const given = answers.find((answer) => answer.ruleId === question.ruleId);
          return [question.ruleId, resolveAuditAnswer(question, given?.answer)] as const;
        }),
      );

      for (const question of audit.questions) {
        const resolved = resolvedAnswers.get(question.ruleId)!;
        answeredRuleIds.add(question.ruleId);
        if (resolved.usedVmindDefault) {
          // Bos, belirsiz veya soruyla ilgisiz cevap sessizce kaybolmaz:
          // guclu VMind varsayilani hem rapora hem de gercek taslaga girer.
          assumptions.push({
            ruleId: question.ruleId,
            question: question.question,
            assumed: resolved.answer,
          });
          trail?.assumption(question.ruleId, question.question, resolved.answer);
        } else {
          trail?.questionAnswered(question.ruleId, resolved.answer);
        }
      }

      // Bos birakilan sorunun varsayilani yalnizca rapora yazilmakla kalmaz;
      // gercek taslaga da uygulanir. Onceki davranis "1 TB varsayilacak"
      // deyip network alanini bos birakiyor, blocker'i cozmuyordu.
      const effectiveAnswers = audit.questions.map((question) => {
        return {
          ruleId: question.ruleId,
          answer: resolvedAnswers.get(question.ruleId)!.answer,
        };
      });
      if (effectiveAnswers.length > 0 && callbacks.onRevise) {
        emit('revise', `${effectiveAnswers.length} cevap/varsayim taslaga isleniyor.`);
        const feedback = await callbacks.onRevise(effectiveAnswers, ctx);
        for (const ruleId of feedback?.unresolvedRuleIds ?? []) {
          // Boyutsal olarak eksik cevap (ornegin yalnizca "100 Mbps")
          // cozulmus sayilmaz; sonraki tur daha acik soruyla yeniden sorulur.
          answeredRuleIds.delete(ruleId);
        }
      }
    }

    if (!audit) return halt('Denetim calistirilamadi.');

    // Tur limiti dolduysa son bir denetim daha yapilir; blocker kaldiysa durulur.
    if (rounds >= MAX_AUDIT_ROUNDS) {
      const state = ctx.session.read();
      audit = await this.deps.auditor.audit({
        currency: state.currency,
        list: state.list,
        ...(spec ? { spec } : {}),
        answeredRuleIds,
      });
      emit('audit', `Tur limiti (${MAX_AUDIT_ROUNDS}) doldu. Son denetim: ${audit.summary}`);
    }

    let price = priceTools.calculate(ctx) as PriceSnapshot;
    trail?.priceSnapshot('yayin oncesi', {
      currency: price.currency,
      totalHourCost: price.totalHourCost,
      totalMonthCost: price.totalMonthCost,
      lineCount: price.lines.length,
    });

    if (!audit.publishable) {
      const blockers = audit.gaps.filter((gap) => gap.severity === 'blocker');
      return halt(
        `Cozulmemis ${blockers.length} kritik eksik var; teklif yayinlanamaz: ` +
          blockers.map((gap) => gap.ruleId).join(', '),
        { ...(spec ? { spec } : {}), ...(draft ? { draft } : {}), audit, price },
      );
    }

    // --- 7. ONAY ---------------------------------------------------------
    emit('approve', 'Onay ekrani gosteriliyor.');
    const summary: PublishSummary = {
      price,
      audit,
      assumptions,
      estimate: ctx.session.read(),
      ...(spec ? { spec } : {}),
      ...(draft ? { draft } : {}),
    };
    const decision = (await callbacks.onApprove?.(summary)) ?? { approved: false };

    // Onay kapisi acikken web editoru ctx.session'i degistirebilir. Karar
    // verildigi anda fiyat/denetim MUTLAKA guncel state'ten yeniden uretilir;
    // aksi halde ekranda yeni, yayinlamada eski toplam kullanilirdi.
    const approvalState = ctx.session.read();
    price = priceTools.calculate(ctx) as PriceSnapshot;
    audit = await this.deps.auditor.audit({
      currency: approvalState.currency,
      list: approvalState.list,
      ...(spec ? { spec } : {}),
      answeredRuleIds,
    });
    if (draft) {
      draft = {
        ...draft,
        choices: approvalState.list.map((item) => ({
          service: item.service,
          itemId: item.id,
          rationale:
            draft?.choices.find((choice) => choice.itemId === item.id)?.rationale ??
            'Onay öncesi düzenleme ile eklendi veya güncellendi.',
        })),
      };
    }

    if (!decision.approved) {
      emit('done', 'Onay verilmedi; teklif yayinlanmadi (dry-run sonuclari hazir).');
      return {
        stage: 'done',
        ...(spec ? { spec } : {}),
        ...(draft ? { draft } : {}),
        audit,
        price,
        assumptions,
        rounds,
        published: false,
        events,
      };
    }

    if (approvalState.list.length === 0) {
      return halt('Onay öncesi düzenleme bütün kalemleri çıkardı; boş teklif yayınlanamaz.', {
        ...(spec ? { spec } : {}),
        ...(draft ? { draft } : {}),
        audit,
        price,
      });
    }
    if (!audit.publishable) {
      const blockers = audit.gaps.filter((gap) => gap.severity === 'blocker');
      return halt(
        `Onay öncesi düzenlemeden sonra ${blockers.length} kritik eksik var; teklif yayınlanamaz: ` +
          blockers.map((gap) => gap.ruleId).join(', '),
        { ...(spec ? { spec } : {}), ...(draft ? { draft } : {}), audit, price },
      );
    }

    const approvedBy = decision.approvedBy ?? 'bilinmeyen';
    approvalTools.grant(ctx, { approvedBy });
    trail?.approval(approvedBy);

    // --- 8. YAYINLA + MUTABAKAT ------------------------------------------
    emit('publish', 'Teklif platforma kaydediliyor.');
    const saved = (await publishTools.save(ctx, { dryRun: false })) as {
      estimateId: string;
      shareUrl: string;
    };
    trail?.publish({ estimateId: saved.estimateId, shareUrl: saved.shareUrl, dryRun: false });

    let reconcileResult: ReconcileResult | undefined;
    if (ctx.client) {
      emit('reconcile', 'Kaydedilen teklif geri okunup tutar karsilastiriliyor.');
      const remotePayload = await ctx.client.getEstimate(saved.estimateId);
      reconcileResult = reconcile(this.deps.catalog, price, parseRemoteEstimate(remotePayload));
      emit('reconcile', reconcileResult.message, reconcileResult);
      trail?.reconcile({
        ok: reconcileResult.ok,
        monthlyDiff: reconcileResult.monthlyDiff,
        message: reconcileResult.message,
      });

      if (!reconcileResult.ok) {
        // PLAN 5.C: "fark varsa akis durup rapor ediyor."
        return halt(reconcileResult.message, {
          ...(spec ? { spec } : {}),
          ...(draft ? { draft } : {}),
          audit,
          price,
          reconcile: reconcileResult,
          published: true,
          shareUrl: saved.shareUrl,
        });
      }
    }

    emit('done', `Teklif hazir: ${saved.shareUrl}`);
    return {
      stage: 'done',
      ...(spec ? { spec } : {}),
      ...(draft ? { draft } : {}),
      audit,
      price,
      ...(reconcileResult ? { reconcile: reconcileResult } : {}),
      assumptions,
      rounds,
      published: true,
      shareUrl: saved.shareUrl,
      events,
    };
  }
}

/** Onay ekranina konacak metin — LLM olmadan da uretilir. */
export function renderApprovalScreen(summary: PublishSummary): string {
  const lines: string[] = [];
  lines.push('TEKLIF');
  for (const line of summary.price.lines) {
    const monthly = typeof line.monthly === 'number' ? line.monthly.toFixed(2) : String(line.monthly);
    lines.push(`  ${line.productName} — ${String(line.count)} — ${monthly} ${summary.price.currency}/ay`);
  }
  lines.push(
    `  TOPLAM: ${summary.price.totalMonthCost.toFixed(2)} ${summary.price.currency}/ay ` +
      `(${summary.price.totalHourCost.toFixed(6)} ${summary.price.currency}/saat)`,
  );

  lines.push('', 'YAPTIGIM VARSAYIMLAR');
  if (summary.assumptions.length === 0) {
    lines.push('  Varsayim yapilmadi.');
  } else {
    for (const assumption of summary.assumptions) {
      lines.push(`  ${assumption.question} -> ${assumption.assumed}`);
    }
  }

  const unresolved = summary.audit.gaps.filter((gap) => gap.severity !== 'optional');
  lines.push('', 'COZULMEMIS NOKTALAR');
  lines.push(unresolved.length === 0 ? '  Yok.' : '');
  for (const gap of unresolved) {
    lines.push(`  [${gap.severity}] ${gap.message}`);
  }

  const upsells = summary.audit.gaps.filter((gap) => gap.severity === 'optional');
  lines.push('', 'ONERDIKLERIM');
  lines.push(upsells.length === 0 ? '  Yok.' : '');
  for (const gap of upsells) {
    lines.push(`  ${gap.message}`);
  }
  for (const note of summary.audit.contextualNotes) {
    lines.push(`  ${note}`);
  }

  return lines.join('\n');
}
