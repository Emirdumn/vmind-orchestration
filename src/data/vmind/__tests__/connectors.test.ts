import { describe, expect, it } from "vitest";
import {
  averageReadiness,
  connectorProfiles,
  countProfilesByStage,
  getConnectorProfile,
} from "../connectors";

describe("connector profiles", () => {
  it("her kaynak icin connector profili tanimlidir", () => {
    expect(connectorProfiles.map((profile) => profile.id).sort()).toEqual([
      "logo",
      "portvmind",
      "runbooks",
      "smax",
      "vrpmind",
    ]);
  });

  it("riskli Logo connector'u blokajli ve finansal veri sinifindadir", () => {
    const logo = getConnectorProfile("logo");
    expect(logo?.stage).toBe("blocked");
    expect(logo?.dataClasses).toContain("financial");
    expect(logo?.blockers.length).toBeGreaterThan(0);
  });

  it("ortalama hazirlik yuzdesini hesaplar", () => {
    expect(averageReadiness()).toBeGreaterThan(0);
    expect(averageReadiness()).toBeLessThanOrEqual(100);
  });

  it("connector asamalarini sayar", () => {
    const counts = countProfilesByStage();
    expect(counts.export_ready).toBeGreaterThanOrEqual(1);
    expect(counts.blocked).toBe(1);
  });
});
