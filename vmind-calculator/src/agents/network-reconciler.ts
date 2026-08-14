import { resolveProductAlias } from '../core/catalog/aliases.js';
import { callTool, type ToolContext } from '../mcp/tools/index.js';
import type { RequirementSpec } from './types.js';

export interface NetworkReconcileResult {
  changed: boolean;
  message: string;
}

/**
 * Public/VPN fiyatlarini ve internal sistemin acikca istenen outbound trafigini
 * tek Router girisinde toplar. LLM dogru mimariyi
 * bilse bile bazen FIP ve egress'i standalone veya backend altina yazabiliyor;
 * bu son adim cift fiyatlamayi tool katmaninda deterministik olarak engeller.
 */
export async function reconcileNetworkTopology(
  ctx: ToolContext,
  spec: RequirementSpec,
): Promise<NetworkReconcileResult> {
  const egressGb = spec.router?.egressGb ?? spec.egressGb;
  const isPublicEdge = spec.networkExposure === 'public' || spec.networkExposure === 'vpn';
  const isInternalOutbound = spec.networkExposure === 'internal' && egressGb !== undefined;
  if (!isPublicEdge && !isInternalOutbound) {
    return { changed: false, message: 'Internal topolojide fiyatlanacak outbound belirtilmedi.' };
  }
  const floatingIpCount = isPublicEdge
    ? (spec.router?.floatingIpCount ?? spec.floatingIpCount)
    : undefined;
  if (egressGb === undefined && floatingIpCount === undefined) {
    return { changed: false, message: 'Public/VPN giris miktarlari henuz bilinmiyor.' };
  }

  const productCode = (alias: string): string => {
    const resolved = resolveProductAlias(alias);
    if (!resolved || !ctx.catalog.has(resolved.productCode)) {
      throw new Error(`Katalogda "${alias}" urunu bulunamadi.`);
    }
    ctx.catalog.assertPriceable(resolved.productCode, ctx.session.read().currency);
    return resolved.productCode;
  };

  const routerData: Record<string, unknown> = {
    ...(floatingIpCount !== undefined
      ? {
          floatingIp: {
            productCode: productCode('floating ip'),
            count: floatingIpCount,
          },
        }
      : {}),
    ...(egressGb !== undefined
      ? {
          network: {
            productCode: productCode('egress'),
            traffic: egressGb,
            unit: 'GB',
          },
        }
      : {}),
  };

  const before = ctx.session.read();
  const routerItems = before.list.filter((item) => item.service === 'router');
  const primaryRouter = routerItems[0];

  for (const item of before.list) {
    if (item.service === 'floating-ip' || item.service === 'data-transfer') {
      await callTool(ctx, 'estimate.removeItem', { itemId: item.id });
      continue;
    }
    if (item.service === 'compute') {
      await callTool(ctx, 'estimate.updateItem', {
        itemId: item.id,
        patch: { floatingIp: undefined, network: undefined, router: undefined },
      });
      continue;
    }
    if (item.service === 'load-balancer') {
      await callTool(ctx, 'estimate.updateItem', {
        itemId: item.id,
        patch: { network: undefined },
      });
    }
  }

  if (primaryRouter) {
    await callTool(ctx, 'estimate.updateItem', {
      itemId: primaryRouter.id,
      patch: {
        floatingIp: undefined,
        network: undefined,
        ...routerData,
      },
    });
    for (const duplicate of routerItems.slice(1)) {
      await callTool(ctx, 'estimate.removeItem', { itemId: duplicate.id });
    }
  } else {
    await callTool(ctx, 'estimate.addItem', { service: 'router', data: routerData });
  }

  return {
    changed: true,
    message:
      `Ag topolojisi uzlastirildi: ${isPublicEdge ? 'Floating IP ve ' : ''}outbound tek Router girisinde tutuldu; ` +
      'compute/LB/standalone tekrarları kaldırıldı.',
  };
}
