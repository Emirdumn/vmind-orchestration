import { useMemo, useState } from 'react';

import {
  buildGuidedQuotePrompt,
  PROFILE_DEFAULTS,
  profileRisk,
  type CapacityPreset,
  type GuidedQuoteConfig,
  type LoadBalancerKind,
  type NetworkExposure,
  type ReliabilityProfile,
  type WorkloadKind,
} from './guidedQuote';

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
  recommended?: boolean;
}

const PROFILES: Choice<ReliabilityProfile>[] = [
  {
    value: 'recommended',
    label: 'VMind Önerisi',
    description: '2+ güçlü sunucu, LB, 500 GB Premium SSD, yedek ve 1 TB trafik.',
    recommended: true,
  },
  {
    value: 'balanced',
    label: 'Dengeli',
    description: 'Çoklu sunucuyla süreklilik; daha ekonomik disk seçimi.',
  },
  {
    value: 'economy',
    label: 'Ekonomik',
    description: 'Tek sunucu. Daha düşük maliyet, daha yüksek kesinti ve veri riski.',
  },
];

const WORKLOADS: Choice<WorkloadKind>[] = [
  { value: 'web', label: 'Web / uygulama', description: 'İnternet sitesi, API veya mobil uygulama' },
  { value: 'business', label: 'Kurumsal sistem', description: 'ERP, CRM veya şirket içi uygulama' },
  { value: 'database', label: 'Veritabanı', description: 'Düşük gecikmeli, disk yoğun iş yükü' },
  { value: 'general', label: 'Genel sunucu', description: 'Dosya, servis veya özel kullanım' },
];

const EXPOSURES: Choice<NetworkExposure>[] = [
  {
    value: 'public',
    label: 'Güvenli yayın',
    description: 'Web/API LB ile açık; veritabanı ve yönetim özel ağda',
    recommended: true,
  },
  { value: 'vpn', label: 'Yalnızca VPN', description: 'İnternete açık servis yok; özel erişim' },
  { value: 'internal', label: 'Yalnızca iç ağ', description: 'Sadece aynı özel ağdan erişim' },
];

const CAPACITIES: Choice<CapacityPreset>[] = [
  { value: 'starter', label: 'Başlangıç', description: '2 vCPU / 4 GB RAM' },
  { value: 'standard', label: 'Standart', description: '4 vCPU / 8 GB RAM' },
  { value: 'powerful', label: 'Güçlü', description: '8 vCPU / 16 GB RAM', recommended: true },
];

function ChoiceCards<T extends string>({
  choices,
  value,
  onChange,
}: {
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="guided-choices">
      {choices.map((choice) => (
        <button
          type="button"
          className={`choice-card ${value === choice.value ? 'selected' : ''}`}
          aria-pressed={value === choice.value}
          onClick={() => onChange(choice.value)}
          key={choice.value}
        >
          <span>
            {choice.label}
            {choice.recommended && <small>ÖNERİLEN</small>}
          </span>
          <em>{choice.description}</em>
        </button>
      ))}
    </div>
  );
}

export function GuidedQuoteBuilder({
  starting,
  onStart,
  onEditText,
  onImport,
}: {
  starting: boolean;
  onStart: (config: GuidedQuoteConfig) => void;
  onEditText: (text: string) => void;
  onImport: (file: File) => Promise<'guided' | 'natural'>;
}) {
  const [config, setConfig] = useState<GuidedQuoteConfig>({ ...PROFILE_DEFAULTS.recommended });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const prompt = useMemo(() => buildGuidedQuotePrompt(config), [config]);
  const risk = profileRisk(config);

  const patch = <K extends keyof GuidedQuoteConfig>(key: K, value: GuidedQuoteConfig[K]): void => {
    setConfig((previous) => ({ ...previous, [key]: value }));
  };

  const selectProfile = (profile: ReliabilityProfile): void => {
    setConfig((previous) => ({
      ...PROFILE_DEFAULTS[profile],
      workload: previous.workload,
      exposure: previous.exposure,
      currency: previous.currency,
      notes: previous.notes,
    }));
  };

  return (
    <section className="guided-builder" aria-label="Tıklayarak teklif oluşturma">
      <div className="guided-heading">
        <div>
          <h2>Tıklayarak teklif oluştur</h2>
          <p className="muted small">
            Yazmak zorunda değilsiniz. Hazır seçeneklere dokunun; her ayrıntıyı sonra değiştirebilirsiniz.
          </p>
        </div>
        <span className="guided-step">1 dakikada hazır</span>
      </div>

      <div className="spreadsheet-import">
        <label>
          <span>Excel veya CSV’den başla</span>
          <input
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={starting || importing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setImporting(true);
              setImportStatus(null);
              void onImport(file).then(
                (route) => setImportStatus(
                  route === 'guided'
                    ? 'Tablo tanındı; LLM kullanmadan teklif başlatıldı.'
                    : 'Serbest tablo güçlü yorumlama katmanına aktarıldı.',
                ),
                (error: unknown) => setImportStatus(
                  error instanceof Error ? error.message : 'Dosya yüklenemedi.',
                ),
              ).finally(() => {
                setImporting(false);
                event.target.value = '';
              });
            }}
          />
        </label>
        <small className="muted">
          Standart sütunlar araçlarla sıfır token; belirsiz tablolar katmanlı modelle yorumlanır. En fazla 2 MB.
        </small>
        {importStatus && <p className="small">{importStatus}</p>}
      </div>

      <fieldset>
        <legend>1. Önceliğiniz ne?</legend>
        <ChoiceCards choices={PROFILES} value={config.profile} onChange={selectProfile} />
      </fieldset>

      <fieldset>
        <legend>2. Ne çalışacak?</legend>
        <ChoiceCards
          choices={WORKLOADS}
          value={config.workload}
          onChange={(value) => patch('workload', value)}
        />
      </fieldset>

      <fieldset>
        <legend>3. Kimler erişecek?</legend>
        <ChoiceCards
          choices={EXPOSURES}
          value={config.exposure}
          onChange={(value) => patch('exposure', value)}
        />
      </fieldset>

      <fieldset>
        <legend>4. Sunucu gücü</legend>
        <ChoiceCards
          choices={CAPACITIES}
          value={config.capacity}
          onChange={(value) => patch('capacity', value)}
        />
      </fieldset>

      <div className={`reliability-summary ${risk.tone}`}>
        <strong>{risk.tone === 'good' ? 'Süreklilik koruması açık' : 'Risk uyarısı'}</strong>
        <span>{risk.text}</span>
      </div>

      <button type="button" className="details-toggle ghost" onClick={() => setDetailsOpen(!detailsOpen)}>
        {detailsOpen ? 'Ayrıntıları gizle' : 'Kapasite ve maliyet ayrıntılarını özelleştir'}
      </button>

      {detailsOpen && (
        <div className="guided-details">
          <label>
            <span>Sunucu adedi</span>
            <input
              type="number"
              min={1}
              max={99}
              value={config.instanceCount}
              onChange={(event) => patch('instanceCount', Number(event.target.value))}
            />
          </label>
          <label>
            <span>Disk türü</span>
            <select
              value={config.diskTier}
              onChange={(event) => patch('diskTier', event.target.value as GuidedQuoteConfig['diskTier'])}
            >
              <option value="premium">Premium SSD (önerilen)</option>
              <option value="standard">Standard HDD</option>
            </select>
          </label>
          <label>
            <span>Disk / sunucu (GB)</span>
            <input
              type="number"
              min={10}
              value={config.diskGb}
              onChange={(event) => patch('diskGb', Number(event.target.value))}
            />
          </label>
          <label>
            <span>Load Balancer</span>
            <select
              value={config.loadBalancer}
              onChange={(event) => patch('loadBalancer', event.target.value as LoadBalancerKind)}
            >
              <option value="app">App Load Balancer</option>
              <option value="net">Net Load Balancer</option>
              <option value="none">Kullanma</option>
            </select>
          </label>
          <label>
            <span>Yedek / ay</span>
            <input
              type="number"
              min={0}
              max={90}
              value={config.backupCount}
              onChange={(event) => patch('backupCount', Number(event.target.value))}
            />
          </label>
          <label>
            <span>Outbound trafik (GB / ay)</span>
            <input
              type="number"
              min={1}
              value={config.egressGb}
              onChange={(event) => patch('egressGb', Number(event.target.value))}
            />
          </label>
          {config.exposure === 'public' && (
            <label>
              <span>Floating IP</span>
              <input
                type="number"
                min={1}
                max={20}
                value={config.floatingIpCount}
                onChange={(event) => patch('floatingIpCount', Number(event.target.value))}
              />
            </label>
          )}
          <label>
            <span>Para birimi</span>
            <select
              value={config.currency}
              onChange={(event) => patch('currency', event.target.value as 'TL' | 'USD')}
            >
              <option value="TL">Türk Lirası</option>
              <option value="USD">Dolar</option>
            </select>
          </label>
          <label className="wide">
            <span>Ek notunuz (isteğe bağlı)</span>
            <textarea
              rows={2}
              value={config.notes}
              onChange={(event) => patch('notes', event.target.value)}
              placeholder="Örn. yoğun saatlerde 10.000 kullanıcı olacak"
            />
          </label>
        </div>
      )}

      {config.exposure === 'vpn' && (
        <p className="guided-warning small">
          VPN erişimi mimariye eklenir; canlı katalogda fiyatlanabilir VPN ürünü yoksa ajan teklifi
          yayınlamaz ve satış ekibiyle netleştirilmesini ister.
        </p>
      )}

      <div className="row guided-actions">
        <button disabled={starting} onClick={() => onStart(config)}>
          {starting ? 'Başlatılıyor…' : 'Bu seçimlerle teklif hazırla'}
        </button>
        <button className="ghost" disabled={starting} onClick={() => onEditText(prompt)}>
          Metne aktar ve düzenle
        </button>
      </div>
      <p className="muted small guided-disclosure">
        VMind Önerisi daha yüksek hizmet sürekliliği hedefler ve ekonomik profile göre daha maliyetli
        olabilir. Nihai fiyat canlı katalogdan hesaplanır; yayınlama yine sizin onayınızla yapılır.
      </p>
    </section>
  );
}
