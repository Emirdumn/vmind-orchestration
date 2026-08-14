import { callTool, type ToolContext, type ToolName } from '../mcp/tools/index.js';
import { DESIGNER_TOOLS, toolDefinitions } from './designer.js';
import type { LlmClient } from './llm.js';
import { APPROVAL_EDITOR_SYSTEM } from './prompts.js';

/** Editorde geri alma tool'u yok: hata halinde tum edit turunu kod geri alir. */
export const APPROVAL_EDITOR_TOOLS: readonly ToolName[] = DESIGNER_TOOLS.filter(
  (name) => name !== 'estimate.undo',
);

export interface ApprovalEditResult {
  summary: string;
  changed: boolean;
  toolCalls: number;
  rejectedToolCalls: number;
  rejections: string[];
}

export class ApprovalEditor {
  constructor(private readonly llm: LlmClient) {}

  async edit(ctx: ToolContext, instruction: string): Promise<ApprovalEditResult> {
    const beforeUndoCount = ctx.session.undoHistory().length;
    const beforeState = ctx.session.read();

    try {
      const result = await this.llm.toolLoop({
        system: APPROVAL_EDITOR_SYSTEM,
        userMessage: [
          'ONAY ONCESI DUZENLEME TALEBI:',
          instruction.trim(),
          '',
          'TEKLIFIN GUNCEL HALI:',
          JSON.stringify(ctx.session.read(), null, 1),
          '',
          'Yalnizca talep edilen degisikligi uygula; baska kalemlere dokunma.',
        ].join('\n'),
        tools: toolDefinitions().filter((tool) =>
          APPROVAL_EDITOR_TOOLS.includes(tool.name.replace('_', '.') as ToolName),
        ),
        maxTokens: 2400,
        maxIterations: 16,
        maxRepeatedToolCalls: 2,
        runTool: async (name, input) => {
          const toolName = name.replace('_', '.') as ToolName;
          if (!APPROVAL_EDITOR_TOOLS.includes(toolName)) {
            throw new Error(`"${name}" onay editorune acik degil.`);
          }
          return callTool(ctx, toolName, input);
        },
      });

      const rejections = result.toolCalls
        .filter((call) => !call.ok && call.error)
        .map((call) => `${call.name}: ${call.error}`);
      return {
        summary: [
          JSON.stringify(ctx.session.read()) === JSON.stringify(beforeState)
            ? 'Teklif değişmedi.'
            : 'Teklif güncellendi.',
          result.finalText.trim(),
          rejections.length > 0
            ? `${rejections.length} işlem doğrulamadan geçmedi: ${rejections.join(' | ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        changed: JSON.stringify(ctx.session.read()) !== JSON.stringify(beforeState),
        toolCalls: result.toolCalls.length,
        rejectedToolCalls: rejections.length,
        rejections,
      };
    } catch (error) {
      // Bir edit turu yarida kalirsa o turdaki butun mutasyonlari geri al.
      // Onceki tasarim/duzeltme gecmisi korunur.
      while (ctx.session.undoHistory().length > beforeUndoCount) ctx.session.undo();
      throw error;
    }
  }
}
