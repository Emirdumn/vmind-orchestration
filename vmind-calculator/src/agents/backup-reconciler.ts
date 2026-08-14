import type { EstimateItemRecord } from '../core/estimate/session.js';
import { callTool, type ToolContext } from '../mcp/tools/index.js';

export interface BackupReconcileResult {
  changed: boolean;
  message: string;
  protectedGb: number;
  monthlyCopies: number[];
}

interface BackupGroup {
  productCode: string;
  estimatedCount: number;
  sourceSizeGb: number;
}

function sourceSizeGb(data: Record<string, unknown>): number {
  const size = Number(data['sourceSize']);
  return data['unit'] === 'TB' ? size * 1024 : size;
}

function groupKey(productCode: string, estimatedCount: number): string {
  return `${productCode}\u0000${estimatedCount}`;
}

function formatCapacity(gb: number): string {
  if (gb >= 1024 && gb % 1024 === 0) return `${gb / 1024} TB`;
  return `${Number(gb.toFixed(2))} GB`;
}

function isCanonicalStandaloneBackup(items: EstimateItemRecord[]): boolean {
  const firstBackupIndex = items.findIndex((item) => item.service === 'backup');
  if (firstBackupIndex === -1) return true;

  const backups = items.slice(firstBackupIndex);
  if (backups.some((item) => item.service !== 'backup')) return false;

  const keys = new Set<string>();
  for (const item of backups) {
    const data = item.data;
    if (data['unit'] !== 'GB') return false;
    const key = groupKey(String(data['productCode']), Number(data['estimatedCount']));
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

/**
 * Compute icine gomulmus backup'lari fiyat motorunun destekledigi bagimsiz
 * Backup hizmetine tasir. Böylece Calculator'da backup kendi hizmet kalemi ve
 * kendi fiyat satiri olarak teklifin en sonunda gorunur.
 *
 * Compute backup boyutu instance basinadir; standalone backup boyutu toplam
 * korunacak kapasitedir. Bu nedenle tasirken `sourceSize * compute.count`
 * uygulanir. Ayni urun ve aylik yedek adedine sahip kalemler tek satirda
 * birlestirilir. TB, compute dalindaki platform hatasina takilmamasi icin GB'ye
 * cevrilir.
 */
export async function reconcileBackupItems(ctx: ToolContext): Promise<BackupReconcileResult> {
  const before = ctx.session.read();
  const inlineBackups = before.list.filter(
    (item) => item.service === 'compute' && item.data['backup'] !== undefined,
  );
  const standaloneBackups = before.list.filter((item) => item.service === 'backup');

  if (inlineBackups.length === 0 && isCanonicalStandaloneBackup(before.list)) {
    return {
      changed: false,
      message: standaloneBackups.length
        ? 'Backup zaten ayrı hizmet kalemi olarak teklifin sonunda.'
        : 'Teklifte backup bulunmuyor.',
      protectedGb: standaloneBackups.reduce((total, item) => total + sourceSizeGb(item.data), 0),
      monthlyCopies: standaloneBackups.map((item) => Number(item.data['estimatedCount'])),
    };
  }

  const groups = new Map<string, BackupGroup>();
  const addToGroup = (
    productCode: string,
    estimatedCount: number,
    protectedSourceSizeGb: number,
  ): void => {
    const key = groupKey(productCode, estimatedCount);
    const current = groups.get(key);
    if (current) {
      current.sourceSizeGb += protectedSourceSizeGb;
    } else {
      groups.set(key, { productCode, estimatedCount, sourceSizeGb: protectedSourceSizeGb });
    }
  };

  for (const item of standaloneBackups) {
    addToGroup(
      String(item.data['productCode']),
      Number(item.data['estimatedCount']),
      sourceSizeGb(item.data),
    );
  }

  for (const item of inlineBackups) {
    const backup = item.data['backup'] as Record<string, unknown>;
    const instanceCount = Number(item.data['count']);
    addToGroup(
      String(backup['productCode']),
      Number(backup['estimatedCount']),
      sourceSizeGb(backup) * instanceCount,
    );
  }

  for (const item of inlineBackups) {
    await callTool(ctx, 'estimate.updateItem', {
      itemId: item.id,
      patch: { backup: undefined },
    });
  }
  for (const item of standaloneBackups) {
    await callTool(ctx, 'estimate.removeItem', { itemId: item.id });
  }
  for (const group of groups.values()) {
    await callTool(ctx, 'estimate.addItem', {
      service: 'backup',
      data: {
        productCode: group.productCode,
        sourceSize: group.sourceSizeGb,
        unit: 'GB',
        estimatedCount: group.estimatedCount,
      },
    });
  }

  const grouped = [...groups.values()];
  return {
    changed: true,
    message:
      'Backup ayrı hizmete taşındı ve teklifin sonuna alındı: ' +
      grouped
        .map(
          (group) =>
            `${formatCapacity(group.sourceSizeGb)} korunan kapasite x ayda ${group.estimatedCount} yedek`,
        )
        .join('; ') +
      '. Backup bedeli Calculator’da ayrı fiyat satırı olarak gösterilecek.',
    protectedGb: grouped.reduce((total, group) => total + group.sourceSizeGb, 0),
    monthlyCopies: grouped.map((group) => group.estimatedCount),
  };
}
