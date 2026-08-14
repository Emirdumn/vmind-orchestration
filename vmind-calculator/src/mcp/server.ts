/**
 * FAZ 3 — MCP sunucusu
 *
 * src/mcp/tools/index.ts icindeki tool'lari MCP uzerinden sunar.
 * Bilerek INCE bir adaptor: mantik tool katmaninda, burada yalnizca tasima var.
 * Boylece HITL kapisi ve dogrulamalar MCP olmadan da test edilebiliyor.
 *
 * Calistirma:  npm run mcp
 * Claude Code'a eklemek:  claude mcp add vmind -- npm run mcp --prefix "<proje yolu>"
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { Catalog } from '../core/catalog/catalog.js';
import { RuleEngine } from '../core/rules/engine.js';
import { PlatformApiClient } from '../platform/api-client.js';
import { TOOL_SCHEMAS, callTool, createToolContext, type ToolName } from './tools/index.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../core/catalog/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const readFixture = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));

/** Tool aciklamalari — ajanin tool secimini bunlar yonlendiriyor. */
const DESCRIPTIONS: Record<ToolName, string> = {
  'catalog.listServices': '9 teklif servisini ve basliklarini listeler.',
  'catalog.searchProducts':
    'Katalogda urun arar. DONEN productCode DEGERLERI DISINDA HICBIR KOD KULLANILAMAZ.',
  'catalog.searchFlavors':
    'Instance tipi arar (vCPU/RAM/GPU filtreli). Donen productCode dogrudan compute kaleminde kullanilir.',
  'catalog.listVolumeTypes': 'Block storage tiplerini ve fiyatlarini listeler.',

  'estimate.create': 'Teklifin adini ve para birimini ayarlar (TL veya USD).',
  'estimate.addItem':
    'Teklife kalem ekler. Sema ve katalog dogrulamasindan gecmeyen kalem REDDEDILIR.',
  'estimate.updateItem': 'Kalemi kismi olarak gunceller; birlesik sonuc yeniden dogrulanir.',
  'estimate.removeItem': 'Kalemi siler. estimate.undo ile geri alinabilir.',
  'estimate.read': 'Teklifin tam JSON halini dondurur.',
  'estimate.undo': 'Son degisikligi geri alir.',

  'price.calculate':
    'Teklifin saatlik/aylik tutarini ve satir kirilimini hesaplar. TUTAR URETMENIN TEK YOLU BUDUR — kendi aritmetigini yapma.',
  'validate.check':
    'Kural motorunu calistirir, eksikleri (Gap) dondurur. Yayin oncesi blocker kalmamali.',

  'approval.grant':
    'Insan onayini kaydeder. YALNIZCA satisci onay ekranindan gectikten sonra cagrilir; ajan kendi kendine cagirmaz.',
  'approval.revoke': 'Verilmis onayi geri alir.',
  'publish.save':
    'Teklifi platforma kaydeder ve paylasim linki dondurur. dryRun VARSAYILAN true; gercek yazma icin dryRun:false VE insan onayi gerekir.',
};

export async function main(): Promise<void> {
  const catalog = Catalog.fromEnvelopes(
    readFixture<Product>('products.json'),
    readFixture<Flavor>('flavors.json'),
    readFixture<VolumeType>('volume-types.json'),
  );
  const rules = RuleEngine.fromYaml(
    readFileSync(join(root, 'rules', 'estimate-rules.yaml'), 'utf8'),
    catalog,
  );
  const ctx = createToolContext(catalog, rules, { client: new PlatformApiClient() });

  const server = new McpServer({ name: 'vmind-teklif-ajani', version: '0.1.0' });

  for (const name of Object.keys(TOOL_SCHEMAS) as ToolName[]) {
    server.registerTool(
      name.replace('.', '_'),
      {
        description: DESCRIPTIONS[name],
        inputSchema: TOOL_SCHEMAS[name].shape as z.ZodRawShape,
      },
      async (input: unknown) => {
        try {
          const result = await callTool(ctx, name, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          // Hatalar ajana METIN olarak doner: uydurma kod reddedildiginde ajan
          // nedenini gorup duzeltebilsin diye (ve "reddedilme sayisi" metrigi icin).
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `${(error as Error).name}: ${(error as Error).message}` }],
          };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
}

// Dogrudan calistirildiginda sunucuyu ayaga kaldir.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
