ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS consent_notice_version TEXT,
  ADD COLUMN IF NOT EXISTS consent_source TEXT;

COMMENT ON COLUMN crm.contacts.consent_notice_version IS
  'Kullanıcının kabul ettiği gizlilik/KVKK bildiriminin değişmez sürüm etiketi.';

COMMENT ON COLUMN crm.contacts.consent_source IS
  'Onayın alındığı güvenilir kanal; örneğin Website veya WhatsApp.';
