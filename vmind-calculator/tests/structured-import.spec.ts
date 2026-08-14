import { describe, expect, it } from 'vitest';

import { parseSpreadsheetBuffer } from '../src/web/structured-import.js';

describe('Excel/CSV tool-first içe aktarma', () => {
  it('tanınan CSV sütunlarını LLM kullanmadan guided config yapıyor', async () => {
    const csv = [
      'Sunucu Adedi;vCPU;RAM GB;Disk GB;Disk Türü;Erişim;Load Balancer;Aylık Yedek;Outbound GB;Para Birimi',
      '3;8;16;750;Premium SSD;İnternete açık;App;4;2048;TL',
    ].join('\n');
    const result = await parseSpreadsheetBuffer('ihtiyac.csv', Buffer.from(csv));
    expect(result.route).toBe('guided');
    if (result.route !== 'guided') return;
    expect(result.config).toMatchObject({
      instanceCount: 3, capacity: 'powerful', diskGb: 750, diskTier: 'premium',
      exposure: 'public', loadBalancer: 'app', backupCount: 4, egressGb: 2048,
    });
  });

  it('iki sütunlu alan/değer şablonunu tanıyor', async () => {
    const csv = 'Alan,Değer\nSunucu Adedi,2\nvCPU,4\nRAM GB,8\nDisk GB,200';
    const result = await parseSpreadsheetBuffer('form.csv', Buffer.from(csv));
    expect(result.route).toBe('guided');
    if (result.route === 'guided') {
      expect(result.config).toMatchObject({ instanceCount: 2, capacity: 'standard', diskGb: 200 });
    }
  });

  it('belirsiz serbest tabloyu doğal dil güçlü katmanına hazırlıyor', async () => {
    const csv = 'Uygulama,Not\nERP,yoğun saatlerde büyüyecek\nDB,mevcut boyut bilinmiyor';
    const result = await parseSpreadsheetBuffer('serbest.csv', Buffer.from(csv));
    expect(result.route).toBe('natural');
    if (result.route === 'natural') {
      expect(result.salesText).toContain('Excel/XLSX');
      expect(result.salesText).toContain('ERP');
    }
  });

  it('desteklenmeyen uzantıyı reddediyor', async () => {
    await expect(parseSpreadsheetBuffer('makro.xlsm', Buffer.from('x'))).rejects.toThrow(/csv.*xlsx/i);
  });
});
