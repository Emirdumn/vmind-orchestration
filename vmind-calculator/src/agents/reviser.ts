/**
 * FAZ 6.A — Solution Reviser
 *
 * Satisci bir denetim sorusuna CEVAP verdiginde teklifi gunceller.
 *
 * ## Neden ayri bir ajan gerekti
 *
 * Orchestrator `onRevise` callback'ini bastan beri cagiriyordu ama HICBIR
 * uretim kodu onu saglamiyordu — yalnizca bir test taklidi vardi. Sonuc:
 * satisci "3 TB" yaziyor, arayuz cevabi kabul ediyor, teklif DEGISMIYOR ve
 * ayni eksik bir sonraki denetimde yine cikiyor. Hic sormamaktan kotu:
 * cevabin islendigi izlenimi veriyor.
 *
 * Canli arayuz testinde goruldu (2026-07-30): "Sunuculardan aylik ne kadar
 * veri cikacak?" sorusuna "3 TB" yazildi; fiyat ve COMPUTE_NO_TRANSFER
 * bulgusu aynen kaldi.
 *
 * ## Nicin LLM
 *
 * Cevap serbest metin ("3 TB", "ayda 500 gb", "gerek yok"). Bunu hangi
 * kaleme, hangi alana, hangi birimle yazacagini belirlemek dil isi. Ama
 * FIYAT hesabi burada YOK: ajan yalnizca estimate.* tool'lariyla kalem
 * duzenliyor, tutari yine deterministik motor cikariyor.
 */
import { callTool, type ToolContext, type ToolName } from '../mcp/tools/index.js';
import { normalizeAlias, resolveProductAlias } from '../core/catalog/aliases.js';
import { DESIGNER_TOOLS, toolDefinitions } from './designer.js';
import type { LlmClient } from './llm.js';
import {
  isExplicitAverageBandwidth,
  monthlyEgressGbFromMbps,
  parseBandwidthMbps,
  parseUtilizationPercent,
} from './network-units.js';
import { REVISER_SYSTEM } from './prompts.js';
import { reconcileBackupItems } from './backup-reconciler.js';
import type { AuditQuestion } from './types.js';
import type { QuestionAnswer } from './orchestrator.js';

/** Reviser'a acilan tool'lar Designer ile ayni: publish.* / approval.* YOK. */
export const REVISER_TOOLS: readonly ToolName[] = DESIGNER_TOOLS;

export interface RevisionResult {
  /** Tool katmanina takilan cagri sayisi (uydurma kod, sema hatasi). */
  rejectedToolCalls: number;
  rejections: string[];
  /** Ajanin ne yaptigina dair kisa ozeti. */
  summary: string;
  /** Duzenleme sonrasi kalem sayisi — degisiklik olup olmadigini gormek icin. */
  itemCountAfter: number;
  /** Cevap anlasildi ama fiyatlamak icin hala boyutsal bilgi eksik. */
  unresolvedRuleIds: string[];
}

export class SolutionReviser {
  constructor(private readonly llm: LlmClient) {}

  async revise(
    ctx: ToolContext,
    answers: QuestionAnswer[],
    questions: AuditQuestion[],
  ): Promise<RevisionResult> {
    const rejections: string[] = [];
    const deterministic = await applyDeterministicRevisions(ctx, answers, questions);
    const remaining = answers.filter((answer) => !deterministic.handled.has(answer.ruleId));

    // Fiyat alanlarinin buyuk cogunlugu sayi/birim veya evet-hayir cevabi.
    // Bunlar icin yeniden LLM tool dongusu kurmak 4-60 saniye ve dongu riski
    // yaratiyordu. Hepsi deterministik cozulduyse burada bitir.
    if (remaining.length === 0) {
      const backupReconcile = await reconcileBackupItems(ctx);
      return {
        rejectedToolCalls: 0,
        rejections: [],
        summary:
          [...deterministic.actions, backupReconcile.changed ? backupReconcile.message : '']
            .filter(Boolean)
            .join(' ') || 'Degisiklik gerekmedi.',
        itemCountAfter: ctx.session.read().list.length,
        unresolvedRuleIds: [...deterministic.unresolved],
      };
    }

    const result = await this.llm.toolLoop({
      system: REVISER_SYSTEM,
      // Designer ile AYNI semalar — aciklamalar tek yerde dursun.
      tools: toolDefinitions(),
      userMessage: buildRevisePrompt(ctx, remaining, questions),
      maxTokens: 2400,
      maxIterations: Math.min(20, Math.max(8, 4 + remaining.length * 4)),
      maxRepeatedToolCalls: 2,
      runTool: async (name, input) => {
        const toolName = name.replace('_', '.') as ToolName;
        if (!REVISER_TOOLS.includes(toolName)) {
          throw new Error(`"${name}" bu ajana acik degil.`);
        }
        return callTool(ctx, toolName, input);
      },
    });

    for (const call of result.toolCalls) {
      if (!call.ok && call.error) rejections.push(`${call.name}: ${call.error}`);
    }

    const backupReconcile = await reconcileBackupItems(ctx);

    return {
      rejectedToolCalls: rejections.length,
      rejections,
      summary: [
        ...deterministic.actions,
        result.finalText,
        backupReconcile.changed ? backupReconcile.message : '',
      ]
        .filter(Boolean)
        .join(' '),
      itemCountAfter: ctx.session.read().list.length,
      unresolvedRuleIds: [...deterministic.unresolved],
    };
  }
}

interface ParsedAmount {
  value: number;
  unit: 'GB' | 'TB';
}

function parseAmount(answer: string): ParsedAmount | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(tb|gb)/i.exec(answer);
  if (!match?.[1] || !match[2]) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit: match[2].toUpperCase() as 'GB' | 'TB' };
}

function parseCount(answer: string): number | null {
  const match = /\d+/.exec(answer);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseBackupCount(answer: string): number | null {
  const match =
    /(?:ay(?:da|lik|lık)?\s*(\d+)|(?:\d+\s*(?:adet\s*)?)?(\d+)\s*(?:kez|yedek|backup))/i.exec(
      answer,
    );
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isNegative(answer: string): boolean {
  const normalized = normalizeAlias(answer);
  return /(^| )(hayir|yok|gerek yok|istemiyor|istenmiyor|eklenmeyecek|eklenmesin|olmasin)( |$)/.test(
    normalized,
  );
}

function isPositive(answer: string): boolean {
  const normalized = normalizeAlias(answer);
  return /(^| )(evet|olsun|ekle|eklensin|dahil)( |$)/.test(normalized);
}

async function applyDeterministicRevisions(
  ctx: ToolContext,
  answers: QuestionAnswer[],
  questions: AuditQuestion[],
): Promise<{ handled: Set<string>; unresolved: Set<string>; actions: string[] }> {
  const byRule = new Map(questions.map((question) => [question.ruleId, question]));
  const handled = new Set<string>();
  const unresolved = new Set<string>();
  const actions: string[] = [];

  const state = (): ReturnType<ToolContext['session']['read']> => ctx.session.read();
  const itemFor = (ruleId: string, service: string) => {
    const question = byRule.get(ruleId);
    const items = state().list;
    return (
      (question?.itemId ? items.find((item) => item.id === question.itemId) : undefined) ??
      items.find((item) => item.service === service)
    );
  };
  const update = async (itemId: string, patch: Record<string, unknown>): Promise<void> => {
    await callTool(ctx, 'estimate.updateItem', { itemId, patch });
  };
  const productCode = (alias: string): string => {
    const resolved = resolveProductAlias(alias);
    if (!resolved || !ctx.catalog.has(resolved.productCode)) {
      throw new Error(`Katalogda "${alias}" urunu bulunamadi.`);
    }
    return resolved.productCode;
  };

  for (const answer of answers) {
    const text = answer.answer?.trim() ?? '';
    if (!text) continue;

    // Olumsuz cevap, ekleme onerilerinde bilincli bir "degistirme" kararidir.
    if (isNegative(text)) {
      handled.add(answer.ruleId);
      actions.push(`[${answer.ruleId}] eklenmedi.`);
      continue;
    }

    const transferService: Record<string, string> = {
      OBJ_STORAGE_NO_TRANSFER: 'object-storage',
      COMPUTE_NO_TRANSFER: 'compute',
      LB_NO_TRANSFER: 'load-balancer',
      ROUTER_EMPTY: 'router',
    };
    const service = transferService[answer.ruleId];
    if (service) {
      const amount = parseAmount(text);
      const item = itemFor(answer.ruleId, service);
      if (amount && item) {
        const network = {
          productCode: productCode('egress'),
          traffic: amount.value,
          unit: amount.unit,
        };
        if (answer.ruleId === 'COMPUTE_NO_TRANSFER' || answer.ruleId === 'LB_NO_TRANSFER') {
          // Compute ve LB ayni internet trafigini ayri ayri fiyatlamasin. Bu iki
          // sorunun cevabi her zaman tek merkezî Router kalemine uzlastirilir.
          const before = state();
          const routers = before.list.filter((candidate) => candidate.service === 'router');
          const primaryRouter = routers[0];
          for (const candidate of before.list) {
            if (candidate.service === 'compute' || candidate.service === 'load-balancer') {
              if ((candidate.data as Record<string, unknown>)['network'] !== undefined) {
                await update(candidate.id, { network: undefined });
              }
            } else if (candidate.service === 'data-transfer') {
              await callTool(ctx, 'estimate.removeItem', { itemId: candidate.id });
            }
          }
          if (primaryRouter) {
            await update(primaryRouter.id, { network });
            for (const duplicate of routers.slice(1)) {
              await callTool(ctx, 'estimate.removeItem', { itemId: duplicate.id });
            }
          } else {
            await callTool(ctx, 'estimate.addItem', { service: 'router', data: { network } });
          }
        } else {
          await update(item.id, { network });
        }
        handled.add(answer.ruleId);
        actions.push(
          `[${answer.ruleId}] ${amount.value} ${amount.unit}/ay ` +
            (answer.ruleId === 'COMPUTE_NO_TRANSFER' || answer.ruleId === 'LB_NO_TRANSFER'
              ? 'tek merkezî Router uzerinde uygulandi.'
              : 'uygulandi.'),
        );
      } else {
        const bandwidthMbps = parseBandwidthMbps(text);
        if (bandwidthMbps !== null) {
          handled.add(answer.ruleId);
          const utilizationPercent =
            parseUtilizationPercent(text) ??
            (isExplicitAverageBandwidth(text) ? 100 : null);
          if (utilizationPercent === null || !item) {
            unresolved.add(answer.ruleId);
            actions.push(
              `[${answer.ruleId}] ${bandwidthMbps} Mbps bağlantı hızı anlaşıldı; ` +
                'katalog aylık GB fiyatladığı için ortalama kullanım yüzdesi veya aylık GB/TB olmadan trafik henüz fiyatlanmadı.',
            );
          } else {
            const monthlyGb = monthlyEgressGbFromMbps(bandwidthMbps, utilizationPercent);
            await update(item.id, {
              network: {
                productCode: productCode('egress'),
                traffic: monthlyGb,
                unit: 'GB',
              },
            });
            actions.push(
              `[${answer.ruleId}] ${bandwidthMbps} Mbps x %${utilizationPercent} = ${monthlyGb} GB/ay uygulandi.`,
            );
          }
        }
      }
      continue;
    }

    if (answer.ruleId === 'OBJ_STORAGE_EMPTY') {
      const amount = parseAmount(text);
      const item = itemFor(answer.ruleId, 'object-storage');
      if (amount && item) {
        await update(item.id, {
          storage: {
            productCode: productCode('object storage'),
            size: amount.value,
            unit: amount.unit,
          },
        });
        handled.add(answer.ruleId);
        actions.push(`[${answer.ruleId}] ${amount.value} ${amount.unit} uygulandi.`);
      }
      continue;
    }

    if (answer.ruleId === 'BACKUP_ZERO_COUNT' || answer.ruleId === 'COMPUTE_BACKUP_ZERO_COUNT') {
      const count = parseCount(text);
      const serviceName = answer.ruleId === 'BACKUP_ZERO_COUNT' ? 'backup' : 'compute';
      const item = itemFor(answer.ruleId, serviceName);
      if (count && item) {
        if (serviceName === 'backup') {
          await update(item.id, { estimatedCount: count });
        } else {
          const backup = (item.data as Record<string, unknown>)['backup'] as Record<string, unknown>;
          await update(item.id, { backup: { ...backup, estimatedCount: count } });
        }
        handled.add(answer.ruleId);
        actions.push(`[${answer.ruleId}] aylik ${count} yedek uygulandi.`);
      }
      continue;
    }

    if (answer.ruleId === 'COMPUTE_BACKUP_TB_IGNORED') {
      const amount = parseAmount(text);
      const item = itemFor(answer.ruleId, 'compute');
      if (amount && item) {
        const backup = (item.data as Record<string, unknown>)['backup'] as Record<string, unknown>;
        const sourceSize = amount.unit === 'TB' ? amount.value * 1024 : amount.value;
        await update(item.id, { backup: { ...backup, sourceSize, unit: 'GB' } });
        handled.add(answer.ruleId);
        actions.push(`[${answer.ruleId}] ${sourceSize} GB olarak duzeltildi.`);
      }
      continue;
    }

    if (answer.ruleId === 'COMPUTE_NO_BLOCK_STORAGE') {
      const amount = parseAmount(text);
      const item = itemFor(answer.ruleId, 'compute');
      if (amount && item) {
        const standard = normalizeAlias(text).includes('standard') || normalizeAlias(text).includes('hdd');
        await update(item.id, {
          storage: {
            productCode: productCode(standard ? 'standart disk' : 'premium disk'),
            size: amount.value,
            unit: amount.unit,
          },
        });
        handled.add(answer.ruleId);
        actions.push(`[${answer.ruleId}] kalici disk eklendi.`);
      }
      continue;
    }

    if (answer.ruleId === 'LB_WITHOUT_HA' && isPositive(text)) {
      const item = itemFor(answer.ruleId, 'compute');
      if (item) {
        const current = Number((item.data as Record<string, unknown>)['count'] ?? 1);
        await update(item.id, { count: Math.max(2, current) });
        handled.add(answer.ruleId);
        actions.push('[LB_WITHOUT_HA] sunucu sayisi en az 2 yapildi.');
      }
      continue;
    }

    if (answer.ruleId === 'NO_PUBLIC_ACCESS' && isPositive(text)) {
      const item = itemFor(answer.ruleId, 'compute');
      if (item) {
        await update(item.id, {
          floatingIp: { productCode: productCode('floating ip'), count: 1 },
        });
        handled.add(answer.ruleId);
        actions.push('[NO_PUBLIC_ACCESS] 1 Floating IP eklendi.');
      }
      continue;
    }

    if (answer.ruleId === 'NO_BACKUP_ANYWHERE') {
      const normalized = normalizeAlias(text);
      const requestedCount = parseBackupCount(text);
      const wantsBackup =
        isPositive(text) || (requestedCount !== null && /yedek|backup/.test(normalized));
      if (!wantsBackup) continue;

      const count = requestedCount ?? 4;
      const explicitSize = parseAmount(text);
      const computeItems = state().list.filter((item) => item.service === 'compute');
      const patches: Array<{ itemId: string; sourceSizeGb: number }> = [];
      const missingRoles: string[] = [];

      for (const item of computeItems) {
        const data = item.data as Record<string, unknown>;
        const storage = data['storage'] as Record<string, unknown> | undefined;
        const storageSize = Number(storage?.['size']);
        const storageUnit = storage?.['unit'] === 'TB' ? 'TB' : 'GB';
        const sourceSizeGb = explicitSize
          ? explicitSize.unit === 'TB'
            ? explicitSize.value * 1024
            : explicitSize.value
          : Number.isFinite(storageSize) && storageSize > 0
            ? storageUnit === 'TB'
              ? storageSize * 1024
              : storageSize
            : null;

        if (sourceSizeGb === null) {
          missingRoles.push(String(data['description'] ?? item.id));
        } else {
          patches.push({ itemId: item.id, sourceSizeGb });
        }
      }

      handled.add(answer.ruleId);
      if (patches.length === 0 || missingRoles.length > 0) {
        unresolved.add(answer.ruleId);
        actions.push(
          `[NO_BACKUP_ANYWHERE] Aylık ${count} yedek istendi; ancak ` +
            `${missingRoles.join(', ') || 'sunucular'} için yedeklenecek disk kapasitesi bilinmediğinden fiyat eklenmedi.`,
        );
        continue;
      }

      const backupCode = productCode('backup');
      for (const patch of patches) {
        await update(patch.itemId, {
          backup: {
            productCode: backupCode,
            sourceSize: patch.sourceSizeGb,
            estimatedCount: count,
          },
        });
      }
      actions.push(
        `[NO_BACKUP_ANYWHERE] ${patches.length} sunucuda mevcut disk kapasitesi üzerinden aylık ${count} yedek eklendi.`,
      );
    }
  }

  return { handled, unresolved, actions };
}

export function buildRevisePrompt(
  ctx: ToolContext,
  answers: QuestionAnswer[],
  questions: AuditQuestion[],
): string {
  const byRule = new Map(questions.map((question) => [question.ruleId, question]));
  const lines = [
    'Satisci asagidaki sorulari CEVAPLADI. Teklifi bu cevaplara gore guncelle.',
    '',
  ];

  for (const answer of answers) {
    const question = byRule.get(answer.ruleId);
    lines.push(`- [${answer.ruleId}] ${question?.question ?? '(soru metni yok)'}`);
    lines.push(`  CEVAP: ${answer.answer ?? ''}`);
  }

  lines.push(
    '',
    'Teklifin SU ANKI hali:',
    JSON.stringify(ctx.session.read(), null, 1),
    '',
    'Yukaridaki mevcut hal yetkilidir. Gerekliyse estimate.read aracini EN FAZLA BIR KEZ kullan, sonra gereken kalemleri',
    'estimate.updateItem / estimate.addItem ile duzenle.',
    'Bagimsiz guncellemeleri ayni model cevabinda toplu yap; ayni tool ve girdiyi tekrarlama.',
    'Bitince ne degistirdigini tek satirda Turkce yaz.',
  );
  return lines.join('\n');
}
