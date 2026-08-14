import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CRMStore, CrmValidationError, STAGES, addBusinessDays, normalizePhone } from "./crm-store.js";

const root = mkdtempSync(join(tmpdir(), "vmind-crm-test-"));
let current = new Date("2026-08-14T09:00:00.000Z");
const store = new CRMStore(join(root, "crm.sqlite"), { now: () => current });
const ctx = {
  messageChannel: "whatsapp",
  requesterSenderId: "905551234567@s.whatsapp.net",
  sessionKey: "agent:main:whatsapp:direct:+905551234567",
};

try {
  assert.equal(normalizePhone("905551234567@s.whatsapp.net"), "+905551234567");
  assert.equal(addBusinessDays(current, 2), "2026-08-18");

  const need = store.saveNeed(ctx, {
    customer_need: "2 adet H200 GPU sunucu ile yapay zekâ inference çalıştırmak",
    recommended_service: "VMind GPU Cloud",
    qualified: true,
    company: "Örnek AŞ",
  });
  assert.equal(need.opportunity.stage, STAGES.QUALIFIED);
  assert.match(need.phone, /4567$/);

  const saved = store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: "CALC-18492",
    calculator_url: "https://teklif.43-229-94-48.sslip.io/c/CALC-18492",
    configuration_summary: "2x H200 GPU / AI inference",
    estimated_amount: 125000,
    currency: "TRY",
  });
  assert.equal(saved.created, true);
  assert.equal(saved.calculation.version, 1);
  assert.equal(saved.opportunity.stage, STAGES.CALCULATION_CREATED);
  assert.equal(saved.opportunity.next_follow_up, "2026-08-18");

  assert.throws(
    () => store.saveCalculation(ctx, {
      opportunity_id: need.opportunity.opportunity_id,
      calculator_id: "CALC-EUR-NOT-SUPPORTED",
      calculator_url: "https://teklif.43-229-94-48.sslip.io/c/CALC-EUR-NOT-SUPPORTED",
      configuration_summary: "Desteklenmeyen para birimi testi",
      estimated_amount: 100,
      currency: "EUR",
    }),
    CrmValidationError,
  );

  const duplicate = store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: "CALC-18492",
    calculator_url: "https://teklif.43-229-94-48.sslip.io/c/CALC-18492",
    configuration_summary: "2x H200 GPU / AI inference",
    estimated_amount: 125000,
    currency: "TRY",
  });
  assert.equal(duplicate.created, false);
  assert.equal(store.stats().calculations, 1);

  assert.equal(store.markProposalSent("+905559999999", saved.calculation.calculator_url), null);
  const proposal = store.markProposalSent(
    "+905551234567",
    `Teklifiniz: ${saved.calculation.calculator_url}`,
  );
  assert.equal(proposal.stage, STAGES.PROPOSAL_SENT);

  current = new Date("2026-08-18T08:00:00.000Z");
  assert.equal(store.advanceDueFollowUps(), 1);
  assert.equal(store.getContext(ctx).opportunities[0].stage, STAGES.FOLLOW_UP);

  assert.throws(
    () => store.requestSalesContact(ctx, {
      opportunity_id: need.opportunity.opportunity_id,
      explicit_confirmation: false,
    }),
    CrmValidationError,
  );
  const contactRequest = store.requestSalesContact(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    explicit_confirmation: true,
  });
  assert.equal(contactRequest.stage, STAGES.SALES_CONTACT_REQUESTED);
  assert.equal(store.stats().tasks, 1);

  const revised = store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: "CALC-18492-V2",
    calculator_url: "https://teklif.43-229-94-48.sslip.io/c/CALC-18492-V2",
    configuration_summary: "2x H200 GPU / güncellenmiş inference konfigürasyonu",
    estimated_amount: 130000,
    currency: "TRY",
  });
  assert.equal(revised.calculation.version, 2);
  assert.equal(revised.opportunity.stage, STAGES.SALES_CONTACT_REQUESTED);

  const second = store.saveNeed(ctx, {
    customer_need: "Üç aylık yedekleme ve felaket kurtarma ihtiyacı",
    recommended_service: "Cloud Backup",
    new_opportunity: true,
  });
  assert.notEqual(second.opportunity.opportunity_id, need.opportunity.opportunity_id);
  assert.equal(store.stats().contacts, 1);
  assert.equal(store.stats().opportunities, 2);

  store.setCommunicationStatus(ctx, { status: "opted_out", explicit_confirmation: true });
  assert.equal(store.getContext(ctx).contact.communication_status, "opted_out");

  assert.throws(() => store.saveCalculation(ctx, {
    opportunity_id: second.opportunity.opportunity_id,
    calculator_id: "EVIL-1",
    calculator_url: "https://example.com/offer",
    configuration_summary: "Geçersiz",
    estimated_amount: 10,
  }), CrmValidationError);

  console.log(JSON.stringify({ ok: true, ...store.stats() }));
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
