/**
 * Test icin sahte LLM.
 *
 * Gercek API anahtari olmadan Faz 5'in deterministik iskeletini (Orchestrator
 * akisi, tur sayaci, HITL kapisi, Reconciler, Auditor'in kural tarafi) test
 * etmeyi saglar. Ayrica ajan YANLIS davrandiginda tool katmaninin onu
 * durdurdugunu kanitlamak icin "kotu" davranislar da senaryolastirilabilir.
 */
import type { z } from 'zod';
import type { LlmClient, StructuredRequest, ToolLoopRequest, ToolLoopResult } from '../src/agents/llm.js';

export interface FakeLlmScript {
  /** structured() cagrisinda dondurulecek nesne. */
  structuredResult?: unknown;
  /** toolLoop() sirasinda sirayla yapilacak tool cagrilari. */
  toolPlan?: Array<{ name: string; input: unknown }>;
  finalText?: string;
  textResult?: string;
}

export class FakeLlm implements LlmClient {
  readonly structuredCalls: StructuredRequest<z.ZodTypeAny>[] = [];
  readonly toolLoopCalls: ToolLoopRequest[] = [];
  readonly textCalls: Array<{ system: string; userMessage: string }> = [];

  constructor(private readonly script: FakeLlmScript = {}) {}

  async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    this.structuredCalls.push(request as StructuredRequest<z.ZodTypeAny>);
    if (this.script.structuredResult === undefined) {
      throw new Error('FakeLlm: structuredResult tanimlanmamis');
    }
    // Gercek API structured output'u semaya karsi dogrular; burada da dogrulariz
    // ki test verisi semadan sapmasin.
    return request.schema.parse(this.script.structuredResult) as z.infer<T>;
  }

  async toolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
    this.toolLoopCalls.push(request);
    const toolCalls: ToolLoopResult['toolCalls'] = [];

    for (const step of this.script.toolPlan ?? []) {
      try {
        await request.runTool(step.name, step.input);
        toolCalls.push({ name: step.name, input: step.input, ok: true });
      } catch (error) {
        toolCalls.push({
          name: step.name,
          input: step.input,
          ok: false,
          error: `${(error as Error).name}: ${(error as Error).message}`,
        });
      }
    }

    return { finalText: this.script.finalText ?? '', toolCalls };
  }

  async text(request: { system: string; userMessage: string }): Promise<string> {
    this.textCalls.push(request);
    if (this.script.textResult === undefined) throw new Error('FakeLlm: textResult tanimlanmamis');
    return this.script.textResult;
  }
}

/** Her cagrida hata firlatan LLM — "LLM cokse de deterministik taraf calisir" testleri icin. */
export class BrokenLlm implements LlmClient {
  async structured(): Promise<never> {
    throw new Error('LLM erisilemez');
  }
  async toolLoop(): Promise<never> {
    throw new Error('LLM erisilemez');
  }
  async text(): Promise<never> {
    throw new Error('LLM erisilemez');
  }
}
