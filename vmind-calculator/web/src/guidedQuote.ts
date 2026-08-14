export type ReliabilityProfile = 'recommended' | 'balanced' | 'economy';
export type WorkloadKind = 'web' | 'business' | 'database' | 'general';
export type NetworkExposure = 'public' | 'internal' | 'vpn';
export type CapacityPreset = 'starter' | 'standard' | 'powerful';
export type DiskTier = 'premium' | 'standard';
export type LoadBalancerKind = 'app' | 'net' | 'none';

export interface GuidedQuoteConfig {
  profile: ReliabilityProfile;
  workload: WorkloadKind;
  exposure: NetworkExposure;
  capacity: CapacityPreset;
  instanceCount: number;
  diskTier: DiskTier;
  diskGb: number;
  loadBalancer: LoadBalancerKind;
  backupCount: number;
  egressGb: number;
  floatingIpCount: number;
  currency: 'TL' | 'USD';
  notes: string;
}

export interface QuickAnswer {
  label: string;
  value: string;
  recommended?: boolean;
  description?: string;
}

export function isNetworkAccessQuestion(question: string): boolean {
  const text = question.toLocaleLowerCase('tr-TR');
  return (
    /(internal|public|vpn|ağ erişim|erişim modeli)/i.test(text) ||
    /(sunucu|sistem).*(internetten).*(eriş)/i.test(text)
  ) && !/(floating ip|outbound|trafik)/i.test(text);
}

export const PROFILE_DEFAULTS: Record<ReliabilityProfile, GuidedQuoteConfig> = {
  recommended: {
    profile: 'recommended',
    workload: 'web',
    exposure: 'public',
    capacity: 'powerful',
    instanceCount: 2,
    diskTier: 'premium',
    diskGb: 500,
    loadBalancer: 'app',
    backupCount: 4,
    egressGb: 1024,
    floatingIpCount: 1,
    currency: 'TL',
    notes: '',
  },
  balanced: {
    profile: 'balanced',
    workload: 'web',
    exposure: 'public',
    capacity: 'standard',
    instanceCount: 2,
    diskTier: 'standard',
    diskGb: 150,
    loadBalancer: 'app',
    backupCount: 4,
    egressGb: 500,
    floatingIpCount: 1,
    currency: 'TL',
    notes: '',
  },
  economy: {
    profile: 'economy',
    workload: 'general',
    exposure: 'public',
    capacity: 'starter',
    instanceCount: 1,
    diskTier: 'standard',
    diskGb: 100,
    loadBalancer: 'none',
    backupCount: 0,
    egressGb: 500,
    floatingIpCount: 1,
    currency: 'TL',
    notes: '',
  },
};

const CAPACITY: Record<CapacityPreset, { vcpu: number; ramGb: number; label: string }> = {
  starter: { vcpu: 2, ramGb: 4, label: 'Başlangıç' },
  standard: { vcpu: 4, ramGb: 8, label: 'Standart' },
  powerful: { vcpu: 8, ramGb: 16, label: 'Güçlü' },
};

const WORKLOAD_LABEL: Record<WorkloadKind, string> = {
  web: 'web sitesi veya internet uygulaması',
  business: 'şirket içi kurumsal uygulama',
  database: 'veritabanı iş yükü',
  general: 'genel amaçlı sunucu iş yükü',
};

const LB_LABEL: Record<Exclude<LoadBalancerKind, 'none'>, string> = {
  app: 'App Load Balancer',
  net: 'Net Load Balancer',
};

const positiveInt = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : fallback;

export function buildGuidedQuotePrompt(config: GuidedQuoteConfig): string {
  const capacity = CAPACITY[config.capacity];
  const count = positiveInt(config.instanceCount, 1);
  const diskGb = positiveInt(config.diskGb, 100);
  const egressGb = positiveInt(config.egressGb, 500);
  const floatingIpCount = positiveInt(config.floatingIpCount, 1);
  const backupCount = Math.max(0, Math.round(config.backupCount));
  const parts: string[] = [];

  if (config.currency === 'TL') {
    parts.push('Firma yalnızca Türkiye\'de faaliyet gösteriyor; teklifi TL olarak oluştur.');
  } else {
    parts.push('Teklifi USD olarak oluştur.');
  }

  parts.push(
    `İş yükü ${WORKLOAD_LABEL[config.workload]}. ${count} adet sunucu kullan; her sunucu ` +
      `${capacity.vcpu} vCPU, ${capacity.ramGb} GB RAM ve ${diskGb} GB ` +
      `${config.diskTier === 'premium' ? 'Premium SSD' : 'Standard HDD'} disk içersin.`,
  );

  if (config.profile === 'recommended') {
    parts.push(
      'VMind güvenilirlik önerisi uygulanacak: tek hata noktası oluşturma, en az iki sunucuyu ' +
        'Load Balancer arkasında çalıştır ve yedeklemeyi teklife dahil et.',
    );
  } else if (config.profile === 'balanced') {
    parts.push(
      'Dengeli profil uygulanacak: iki sunucuyla servis sürekliliğini koru; maliyet ve performansı birlikte gözet.',
    );
  } else {
    parts.push(
      'Maliyet öncelikli profil seçildi. Tek sunucunun tek hata noktası olduğunu teklif notunda açıkça belirt; ' +
        'yüksek erişilebilirlik varmış gibi sunma.',
    );
  }

  if (config.loadBalancer !== 'none') {
    parts.push(`${LB_LABEL[config.loadBalancer]} kullan.`);
  } else {
    parts.push('Load Balancer ekleme.');
  }

  if (backupCount > 0) {
    parts.push(
      `Her sunucunun mevcut ${diskGb} GB diskini koru ve ayda ${backupCount} yedek oluştur. ` +
        'Sunucu adetleriyle toplam korunacak kapasiteyi hesapla; yedeklemeyi compute içine gömme. ' +
        'Calculator teklifinin en sonunda bağımsız Backup hizmeti olarak ekle ki backup bedeli müşteriye ayrı fiyat satırında açıkça görünsün. ' +
        'Ayrı bir kaynak diski uydurma.',
    );
  } else {
    parts.push('Yedekleme ekleme; bunun veri kaybı ve geri dönüş süresi riskini açıkça belirt.');
  }

  if (config.exposure === 'public') {
    parts.push(
      'Güvenli internet yayını kullan: yalnızca müşterinin erişeceği web/API/uygulama katmanı ' +
        'App Load Balancer üzerinden public olsun; veritabanı, yönetim ve backend sunucuları ' +
        'VPN/internal özel ağda kalsın. Backend sunuculara doğrudan public IP verme. ' +
        `Public edge için ${floatingIpCount} Floating IP kullan. ` +
        `Aylık ${egressGb} GB outbound trafiği merkezi Router üzerinden geçir. ` +
        'Outbound Data Transfer kalemini yalnızca Router altında bir kez fiyatla; Compute veya Load Balancer altında tekrar etme.',
    );
  } else if (config.exposure === 'internal') {
    parts.push(
      `Sistem yalnızca özel/iç ağdan (internal) erişilecek; public giriş ve Floating IP ekleme. ` +
        `Sunucuların dışarı çıkan aylık ${egressGb} GB outbound trafiğini merkezi Router üzerinden geçir. ` +
        'Outbound Data Transfer kalemini yalnızca Router altında bir kez fiyatla; Compute veya Load Balancer altında tekrar etme.',
    );
  } else {
    parts.push(
      `Sisteme yalnızca VPN/özel erişim üzerinden ulaşılacak; public giriş ve Floating IP ekleme. ` +
        `Aylık ${egressGb} GB outbound trafiği merkezi Router altında yalnızca bir kez fiyatla. ` +
        'VPN ürünü canlı katalogda fiyatlanamıyorsa bunu eksik kalem olarak bildir ve teklifi yayınlama.',
    );
  }

  const notes = config.notes.trim();
  if (notes) parts.push(`Müşterinin ek notu: ${notes}`);
  return parts.join(' ');
}

export function profileRisk(config: GuidedQuoteConfig): { tone: 'good' | 'warn'; text: string } {
  if (config.instanceCount < 2 || config.loadBalancer === 'none') {
    return {
      tone: 'warn',
      text: 'Tek hata noktası var: bakım veya arıza sırasında hizmet kesilebilir.',
    };
  }
  if (config.backupCount < 1) {
    return {
      tone: 'warn',
      text: 'Sunucu katmanı yedekli; ancak veri geri dönüşü için yedekleme seçilmedi.',
    };
  }
  return {
    tone: 'good',
    text: 'Yük dengeleme, çoklu sunucu ve yedekleme birlikte seçildi.',
  };
}

/** Netleştirme ekranlarında yazamayan kullanıcılar için bağlama uygun hazır cevaplar. */
export function quickAnswersForQuestion(question: string, ruleId = ''): QuickAnswer[] {
  const text = `${ruleId} ${question}`.toLocaleLowerCase('tr-TR');

  if (/(para birimi|türk lirası|dolar|currency)/i.test(text)) {
    return [
      { label: 'Türk Lirası', value: 'TL; firma yalnızca Türkiye’de faaliyet gösteriyor.', recommended: true },
      { label: 'Dolar', value: 'USD' },
    ];
  }
  if (
    /(floating ip|internet giriş|public ip)/i.test(text) &&
    /(transfer|outbound|egress|trafik)/i.test(text)
  ) {
    return [
      {
        label: '1 IP + 500 GB',
        value: 'Public girişte 1 Floating IP ve aylık 500 GB outbound; yalnızca merkezi Router’da bir kez fiyatlansın.',
        recommended: true,
      },
      {
        label: '1 IP + 1 TB',
        value: 'Public girişte 1 Floating IP ve aylık 1 TB outbound; yalnızca merkezi Router’da bir kez fiyatlansın.',
      },
      {
        label: '2 IP + 2 TB',
        value: 'Public girişte 2 Floating IP ve aylık 2 TB outbound; yalnızca merkezi Router’da bir kez fiyatlansın.',
      },
    ];
  }
  if (/(floating ip|sabit ip|public ip)/i.test(text)) {
    return [
      { label: '1 IP', value: 'Public giriş için 1 Floating IP, yalnızca Router üzerinde.', recommended: true },
      { label: '2 IP', value: 'Public giriş için 2 Floating IP, yalnızca Router üzerinde.' },
      { label: 'IP olmasın', value: 'Floating IP olmasın; sistem internal.' },
    ];
  }
  if (isNetworkAccessQuestion(question)) {
    return [
      {
        label: 'Güvenli yayın',
        description: 'Yalnızca web/API Load Balancer ile açık; veritabanı ve yönetim VPN/özel ağda.',
        value:
          'Güvenli karma erişim: yalnızca aşağıda adı yazılan web/API/uygulama rolleri App Load Balancer ' +
          'üzerinden public olsun; veritabanı, yönetim ve diğer backend sunucuları VPN/internal özel ağda ' +
          'kalsın. Backend sunuculara doğrudan public IP verilmesin. Public edge için 1 Floating IP ve ' +
          'aylık 1 TB outbound yalnızca merkezi Router üzerinde fiyatlansın. İnternete açılacak roller: web/API.',
        recommended: true,
      },
      {
        label: 'Yalnızca VPN / özel ağ',
        description: 'İnternete açık servis olmaz; yetkili kullanıcılar VPN ile bağlanır.',
        value:
          'VPN/internal özel erişim; hiçbir servis internete public açılmasın ve Floating IP olmasın. ' +
          'Yetkili kullanıcılar VPN/site-to-site üzerinden bağlansın.',
      },
      {
        label: 'Tüm servisler dışarı açık',
        description: 'Daha geniş saldırı yüzeyi oluşturur; önerilmez.',
        value:
          'Public: tüm servisler dışarıdan erişilebilir olsun. Doğrudan sunucu IP’leri yerine merkezi ' +
          'Router ve uygun Load Balancer kullanılsın; güvenlik riski teklif notunda açıkça belirtinsin.',
      },
    ];
  }
  if (/(vcpu|cpu.*ram|ram.*cpu|instance boyut)/i.test(text)) {
    return [
      { label: '8 vCPU / 16 GB', value: 'Her sunucu 8 vCPU ve 16 GB RAM olsun.', recommended: true },
      { label: '4 vCPU / 8 GB', value: 'Her sunucu 4 vCPU ve 8 GB RAM olsun.' },
      { label: '2 vCPU / 4 GB', value: 'Her sunucu 2 vCPU ve 4 GB RAM olsun.' },
    ];
  }
  if (/(backup|yedek)/i.test(text)) {
    return [
      { label: 'Ayda 4 yedek', value: 'Mevcut disk kapasitesi üzerinden ayda 4 yedek alınsın.', recommended: true },
      { label: 'Ayda 30 yedek', value: 'Mevcut disk kapasitesi üzerinden ayda 30 yedek alınsın.' },
      { label: 'Yedek olmasın', value: 'Yedekleme eklenmesin; veri kaybı riski kabul ediliyor.' },
    ];
  }
  if (/(transfer|outbound|egress|trafik)/i.test(text)) {
    return [
      { label: '500 GB / ay', value: '500 GB/ay; yalnızca merkezi Router’da bir kez fiyatlansın.', recommended: true },
      { label: '1 TB / ay', value: '1 TB/ay; yalnızca merkezi Router’da bir kez fiyatlansın.' },
      { label: '2 TB / ay', value: '2 TB/ay; yalnızca merkezi Router’da bir kez fiyatlansın.' },
    ];
  }
  if (/(load balancer|yük dengeleyici|lb tür)/i.test(text)) {
    return [
      { label: 'App LB', value: 'App Load Balancer kullanılsın.', recommended: true },
      { label: 'Net LB', value: 'Net Load Balancer kullanılsın.' },
      { label: 'LB olmasın', value: 'Load Balancer eklenmesin; tek hata noktası riski kabul ediliyor.' },
    ];
  }
  if (/(premium|standard|disk tür|disk tipi)/i.test(text)) {
    return [
      { label: 'Premium SSD', value: 'Premium SSD kullanılsın.', recommended: true },
      { label: 'Standard HDD', value: 'Standard HDD kullanılsın.' },
    ];
  }
  if (/(disk|storage).*(gb|tb|kapasite|boyut)/i.test(text)) {
    return [
      { label: '200 GB', value: 'Her sunucu için 200 GB disk.', recommended: true },
      { label: '100 GB', value: 'Her sunucu için 100 GB disk.' },
      { label: '500 GB', value: 'Her sunucu için 500 GB disk.' },
    ];
  }
  return [];
}
