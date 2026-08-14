import { extname } from 'node:path';

import { readSheet, type SheetData } from 'read-excel-file/node';

import { GuidedQuoteInputSchema, type GuidedQuoteInput } from './guided-flow.js';

export type SpreadsheetImportResult =
  | { route: 'guided'; config: GuidedQuoteInput; sourceRows: number; message: string }
  | { route: 'natural'; salesText: string; sourceRows: number; message: string };

const DEFAULTS: GuidedQuoteInput = {
  profile: 'recommended', workload: 'web', exposure: 'public', capacity: 'powerful',
  instanceCount: 2, diskTier: 'premium', diskGb: 500, loadBalancer: 'app',
  backupCount: 4, egressGb: 1024, floatingIpCount: 1, currency: 'TL', notes: '',
};

const normalize = (value: unknown): string => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();

const FIELD_ALIASES: Record<string, string[]> = {
  profile: ['profil', 'profile', 'oncelik', 'guvenilirlik'],
  workload: ['is yuku', 'workload', 'kullanim', 'uygulama turu'],
  exposure: ['erisim', 'network exposure', 'ag erisimi', 'internet erisimi'],
  capacity: ['kapasite', 'capacity', 'sunucu gucu'],
  instanceCount: ['sunucu adedi', 'instance count', 'adet', 'server count'],
  vcpu: ['vcpu', 'v cpu', 'cpu', 'cekirdek', 'core'],
  ramGb: ['ram gb', 'ram', 'bellek gb', 'memory gb'],
  diskTier: ['disk turu', 'disk tier', 'disk tipi', 'storage tier'],
  diskGb: ['disk gb', 'disk boyutu', 'storage gb', 'disk sunucu gb'],
  loadBalancer: ['load balancer', 'lb', 'yuk dengeleyici'],
  backupCount: ['aylik yedek', 'backup count', 'yedek adedi', 'yedek ay'],
  egressGb: ['outbound gb', 'egress gb', 'aylik trafik gb', 'veri transferi gb'],
  floatingIpCount: ['floating ip', 'public ip adedi', 'floating ip adedi'],
  currency: ['para birimi', 'currency', 'doviz'],
  notes: ['not', 'notes', 'aciklama'],
};

function fieldFor(header: unknown): string | undefined {
  const name = normalize(header);
  return Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(name))?.[0];
}

function parseCsv(text: string): SheetData {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows: Array<Array<string | null>> = [];
  let row: Array<string | null> = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell.trim() || null); cell = ''; }
    else if (char === '\n') { row.push(cell.trim() || null); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  row.push(cell.trim() || null);
  if (row.some((value) => value !== null)) rows.push(row);
  return rows;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return undefined;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function enumValue(value: unknown, choices: Record<string, string[]>): string | undefined {
  const text = normalize(value);
  return Object.entries(choices).find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0];
}

function rowsAsRecord(rows: SheetData): { values: Record<string, unknown>; matched: Set<string> } {
  const values: Record<string, unknown> = {};
  const matched = new Set<string>();
  const compact = rows.filter((row) => row.some((cell) => cell !== null));
  const first = compact[0] ?? [];
  const headerFields = first.map(fieldFor);
  if (headerFields.filter(Boolean).length >= 2) {
    const data = compact[1] ?? [];
    headerFields.forEach((field, index) => {
      if (field && data[index] !== null && data[index] !== undefined) {
        values[field] = data[index]; matched.add(field);
      }
    });
    return { values, matched };
  }
  // İki sütunlu “Alan | Değer” Excel formu.
  for (const row of compact) {
    const field = fieldFor(row[0]);
    if (field && row[1] !== null && row[1] !== undefined) {
      values[field] = row[1]; matched.add(field);
    }
  }
  return { values, matched };
}

function deterministicConfig(rows: SheetData): GuidedQuoteInput | null {
  const { values, matched } = rowsAsRecord(rows);
  // Eksik çekirdek mimariyi varsayımla doldurup sessizce yanlış teklif çıkarma.
  if (!matched.has('instanceCount') || !matched.has('diskGb')) return null;
  if (!matched.has('capacity') && !matched.has('vcpu') && !matched.has('ramGb')) return null;

  const vcpu = asNumber(values['vcpu']) ?? 0;
  const ram = asNumber(values['ramGb']) ?? 0;
  const inferredCapacity = vcpu > 4 || ram > 8 ? 'powerful' : vcpu > 2 || ram > 4 ? 'standard' : 'starter';
  const config: Record<string, unknown> = {
    ...DEFAULTS,
    profile: enumValue(values['profile'], {
      recommended: ['onerilen', 'vmind', 'guclu'], balanced: ['dengeli'], economy: ['ekonomik', 'ucuz'],
    }) ?? DEFAULTS.profile,
    workload: enumValue(values['workload'], {
      web: ['web', 'api', 'uygulama'], business: ['erp', 'crm', 'kurumsal'],
      database: ['database', 'veritabani', 'postgres'], general: ['genel', 'diger'],
    }) ?? DEFAULTS.workload,
    exposure: enumValue(values['exposure'], {
      public: ['public', 'internet', 'dunyaya acik'], internal: ['internal', 'ic ag', 'ozel ag'], vpn: ['vpn'],
    }) ?? DEFAULTS.exposure,
    capacity: enumValue(values['capacity'], {
      starter: ['baslangic', 'starter'], standard: ['standart', 'standard'], powerful: ['guclu', 'powerful'],
    }) ?? inferredCapacity,
    instanceCount: Math.round(asNumber(values['instanceCount']) ?? 0),
    diskTier: enumValue(values['diskTier'], {
      premium: ['premium', 'ssd'], standard: ['standard', 'standart', 'hdd'],
    }) ?? DEFAULTS.diskTier,
    diskGb: Math.round(asNumber(values['diskGb']) ?? 0),
    loadBalancer: enumValue(values['loadBalancer'], {
      app: ['app', 'http', 'https'], net: ['net', 'tcp', 'udp'], none: ['yok', 'none', 'hayir'],
    }) ?? DEFAULTS.loadBalancer,
    backupCount: Math.round(asNumber(values['backupCount']) ?? DEFAULTS.backupCount),
    egressGb: Math.round(asNumber(values['egressGb']) ?? DEFAULTS.egressGb),
    floatingIpCount: Math.round(asNumber(values['floatingIpCount']) ?? DEFAULTS.floatingIpCount),
    currency: enumValue(values['currency'], { TL: ['tl', 'try', 'turk lirasi'], USD: ['usd', 'dolar'] }) ?? DEFAULTS.currency,
    notes: String(values['notes'] ?? ''),
  };
  const parsed = GuidedQuoteInputSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
}

function rowsForModel(rows: SheetData): string {
  const lines = rows.slice(0, 100).map((row) =>
    row.slice(0, 30).map((cell) => String(cell ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 200)).join(' | '),
  );
  return (`Excel/XLSX tablosundan VMind altyapı ihtiyacını çıkar. Boş değer uydurma; belirsiz alanları sor.\n` +
    lines.join('\n')).slice(0, 4_000);
}

export async function parseSpreadsheetBuffer(
  fileName: string,
  buffer: Buffer,
): Promise<SpreadsheetImportResult> {
  const extension = extname(fileName).toLocaleLowerCase('tr-TR');
  if (!['.csv', '.xlsx'].includes(extension)) throw new Error('Yalnızca .csv veya .xlsx desteklenir.');
  const rows = extension === '.csv'
    ? parseCsv(buffer.toString('utf8'))
    : await readSheet(buffer, { trim: true });
  if (rows.length === 0) throw new Error('Dosyada okunabilir satır yok.');
  if (rows.length > 5_000) throw new Error('Dosya en fazla 5.000 satır içerebilir.');
  const config = deterministicConfig(rows);
  if (config) {
    return {
      route: 'guided', config, sourceRows: rows.length,
      message: 'Tanınan sütunlar araçlarla, LLM kullanılmadan teklife dönüştürüldü.',
    };
  }
  return {
    route: 'natural', salesText: rowsForModel(rows), sourceRows: rows.length,
    message: 'Tablo standart şemaya uymuyor; yorumlama için katmanlı modele aktarılacak.',
  };
}
