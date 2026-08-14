import { describe, expect, it } from 'vitest';

import {
  buildGuidedQuotePrompt,
  PROFILE_DEFAULTS,
  profileRisk,
  quickAnswersForQuestion,
} from '../web/src/guidedQuote.js';

describe('tiklanabilir teklif sihirbazi', () => {
  it('VMind onerisi gercek HA bilesenlerini ve tek merkezli trafigi ister', () => {
    const text = buildGuidedQuotePrompt(PROFILE_DEFAULTS.recommended);
    expect(text).toContain('2 adet sunucu');
    expect(text).toContain('8 vCPU, 16 GB RAM');
    expect(text).toContain('500 GB Premium SSD');
    expect(text).toContain('Premium SSD');
    expect(text).toContain('App Load Balancer');
    expect(text).toContain('ayda 4 yedek');
    expect(text).toContain('compute içine gömme');
    expect(text).toContain('en sonunda bağımsız Backup hizmeti');
    expect(text).toContain('ayrı fiyat satırında');
    expect(text).toContain('1024 GB outbound');
    expect(text).toContain('1 Floating IP');
    expect(text).toContain('yalnızca Router altında bir kez fiyatla');
    expect(profileRisk(PROFILE_DEFAULTS.recommended).tone).toBe('good');
  });

  it('internal secimde public giris eklemez ama outbound trafigi Routerda toplar', () => {
    const text = buildGuidedQuotePrompt({
      ...PROFILE_DEFAULTS.recommended,
      exposure: 'internal',
      egressGb: 1024,
    });
    expect(text).toContain('public giriş ve Floating IP ekleme');
    expect(text).toContain('1024 GB outbound');
    expect(text).toContain('yalnızca Router altında bir kez fiyatla');
    expect(text).not.toContain('Public giriş için 1 Floating IP kullan');
  });

  it('ekonomik profili yuksek erisilebilirlik gibi gostermeyip riski aciklar', () => {
    const text = buildGuidedQuotePrompt(PROFILE_DEFAULTS.economy);
    expect(text).toContain('Tek sunucunun tek hata noktası olduğunu');
    expect(text).toContain('Load Balancer ekleme');
    expect(text).toContain('Yedekleme ekleme');
    expect(profileRisk(PROFILE_DEFAULTS.economy)).toEqual({
      tone: 'warn',
      text: 'Tek hata noktası var: bakım veya arıza sırasında hizmet kesilebilir.',
    });
  });

  it('ozel kapasite, para birimi ve kullanici notunu metne aktarir', () => {
    const text = buildGuidedQuotePrompt({
      ...PROFILE_DEFAULTS.balanced,
      capacity: 'powerful',
      instanceCount: 3,
      diskGb: 500,
      currency: 'USD',
      notes: 'Gece toplu rapor çalışacak.',
    });
    expect(text).toContain('3 adet sunucu');
    expect(text).toContain('8 vCPU, 16 GB RAM');
    expect(text).toContain('500 GB');
    expect(text).toContain('USD');
    expect(text).toContain('Gece toplu rapor çalışacak.');
  });

  it('netlestirme sorularina baglama uygun tiklanabilir cevaplar verir', () => {
    const exposure = quickAnswersForQuestion('Sistem internal mı, public mi, VPN mi?');
    expect(exposure.map((item) => item.label)).toEqual([
      'Güvenli yayın',
      'Yalnızca VPN / özel ağ',
      'Tüm servisler dışarı açık',
    ]);
    expect(exposure[0]?.value).toContain('web/API/uygulama rolleri');
    expect(exposure[0]?.value).toContain('veritabanı, yönetim');
    expect(exposure[0]?.value).toContain('1 Floating IP');
    const traffic = quickAnswersForQuestion(
      'Sunuculardan aylık ne kadar veri dışarı çıkacak?',
      'COMPUTE_NO_TRANSFER',
    );
    expect(traffic[0]?.value).toContain('yalnızca merkezi Router’da bir kez');
    expect(
      quickAnswersForQuestion('Load Balancer üzerinden aylık ne kadar trafik geçecek?', 'LB_NO_TRANSFER')[0]
        ?.label,
    ).toBe('500 GB / ay');
    expect(
      quickAnswersForQuestion(
        'Kaç internet giriş noktası/Floating IP kullanılacak ve aylık outbound trafik kaç GB/TB olacak?',
      )[0]?.label,
    ).toBe('1 IP + 500 GB');
  });
});
