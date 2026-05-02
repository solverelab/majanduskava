            {(() => {
              const ra = remondifondiArvutus;
              const rfBasis = plan.allocationPolicies?.remondifond?.defaultBasis;
              const rfSelectVal = rfBasis === "apartment" ? "apartment" : rfBasis === "muu" ? "muu" : "kaasomand";
              const isRfErand = rfSelectVal !== "kaasomand";
              const rfPolicy = plan.allocationPolicies?.remondifond || {};
              const aptCount = plan.building.apartments.length;
              const mEq = derived.period.monthEq || 12;
              const koguPind = derived.building.totAreaM2 || 0;
              const soovitudSaldo = parseFloat(String(remondifond.soovitudSaldoLopp || "").replace(",", ".")) || null;
              const hasSoovitud = soovitudSaldo != null && soovitudSaldo > 0;
              const diff = hasSoovitud ? ra.saldoLopp - soovitudSaldo : null;
              let soovituslikMaar = null;
              if (hasSoovitud && diff < 0) {
                const neededLaekumine = soovitudSaldo - ra.saldoAlgus - ra.fondiMuuTulu + ra.remondifondistKaetavadKokku;
                if (rfSelectVal === "kaasomand" && koguPind > 0) {
                  soovituslikMaar = neededLaekumine / (koguPind * mEq);
                } else if (rfSelectVal === "apartment" && aptCount > 0) {
                  soovituslikMaar = neededLaekumine / (aptCount * mEq);
                }
              }
              const rfCard = { background: N.surface, borderRadius: 8, padding: 16, marginBottom: 16, border: `1px solid ${N.border}` };
              return (
                <>
                  <div style={rfCard}>
                    <div style={{ ...H2_STYLE, marginTop: 0, marginBottom: 12 }}>Remondifond</div>

                    {/* ── Saldo perioodi alguses ── */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={fieldLabel}>Saldo perioodi alguses</div>
                      <div style={{ width: 160 }}>
                        <EuroInput
                          value={remondifond.saldoAlgus}
                          onChange={(v) => { setRemondifond(p => ({ ...p, saldoAlgus: v })); setRepairFundSaldo(v); }}
                          placeholder="Fondi jääk"
                          style={numStyle}
                        />
                      </div>
                    </div>

                    {/* ── Kulude jaotuse alus ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 8, paddingTop: 12, marginBottom: 12 }}>
                      <div style={H3_STYLE}>Kulude jaotuse alus</div>
                      <select
                        value={rfSelectVal}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "kaasomand") {
                            patchRfPolicy({ defaultBasis: "kaasomand", legalBasisBylaws: false, legalBasisSpecialAgreement: false, legalBasisMuu: false, legalBasisTaepsustus: "", allocationBasisMuuKirjeldus: "" });
                          } else {
                            patchRfPolicy({ defaultBasis: v });
                          }
                        }}
                        style={{ ...selectStyle, width: "100%", maxWidth: 320 }}
                      >
                        <option value="kaasomand">Kaasomandi osa suuruse alusel</option>
                        <option value="apartment">Korteri kohta (€/korter/kuu)</option>
                        <option value="muu">Muu jaotusviis</option>
                      </select>
                      {rfSelectVal === "kaasomand" && (
                        <div style={{ fontSize: 13, color: N.dim, marginTop: 6 }}>
                          Kulu jaotatakse KrtS § 40 lg 1 alusel kaasomandi osa suuruse järgi.
                        </div>
                      )}

                      {rfSelectVal === "kaasomand" && (
                        <div style={{ marginTop: 12 }}>
                          <div style={fieldLabel}>Remondifondi makse määr</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <NumberInput
                              value={remondifond.maarOverride ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, maarOverride: v > 0 ? v : null }))}
                              style={{ ...numStyle, width: 100 }}
                              placeholder="0,00"
                            />
                            <span style={{ fontSize: 14, color: N.sub }}>€/m²/kuu</span>
                          </div>
                          {koguPind > 0 && ra.laekuminePerioodis > 0 && (
                            <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
                              Arvutuslik määr: {ra.maarKuusM2.toFixed(4).replace(".", ",")} €/m²/kuu
                            </div>
                          )}
                          <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
                            Perioodis koguneb: {euroEE(ra.laekuminePerioodis)}
                          </div>
                        </div>
                      )}

                      {rfSelectVal === "apartment" && (
                        <div style={{ marginTop: 12 }}>
                          <div style={fieldLabel}>Remondifondi makse määr (€/korter/kuu)</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <NumberInput
                              value={remondifond.maarKorterKuu ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, maarKorterKuu: v > 0 ? v : null }))}
                              style={{ ...numStyle, width: 100 }}
                              placeholder="0,00"
                            />
                            <span style={{ fontSize: 14, color: N.sub }}>€/korter/kuu</span>
                          </div>
                          <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
                            Perioodis koguneb: {euroEE(ra.laekuminePerioodis)}
                          </div>
                        </div>
                      )}

                      {rfSelectVal === "muu" && (
                        <div style={{ marginTop: 12 }}>
                          <div style={fieldLabel}>Planeeritud kogumine perioodis</div>
                          <EuroInput
                            value={remondifond.planeeritudKogumine}
                            onChange={(v) => setRemondifond(p => ({ ...p, planeeritudKogumine: v }))}
                            style={{ ...numStyle, width: 160 }}
                          />
                        </div>
                      )}

                      {isRfErand && (
                        <div style={{ marginTop: 12, padding: 12, background: N.muted, borderRadius: 6 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Erandi alus</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <label style={{ display: "flex", gap: 8, fontSize: 14, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={!!rfPolicy.legalBasisBylaws}
                                onChange={(e) => patchRfPolicy({ "legalBasisBylaws": e.target.checked })}
                              />
                              Põhikiri
                            </label>
                            <label style={{ display: "flex", gap: 8, fontSize: 14, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={!!rfPolicy.legalBasisSpecialAgreement}
                                onChange={(e) => patchRfPolicy({ "legalBasisSpecialAgreement": e.target.checked })}
                              />
                              Erikokkulepe
                            </label>
                            <label style={{ display: "flex", gap: 8, fontSize: 14, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={!!rfPolicy.legalBasisMuu}
                                onChange={(e) => patchRfPolicy({ "legalBasisMuu": e.target.checked })}
                              />
                              Muu alus
                            </label>
                            <div style={{ marginTop: 4 }}>
                              <div style={fieldLabel}>Täpsustus</div>
                              <input
                                value={rfPolicy.legalBasisTaepsustus || ""}
                                onChange={(e) => patchRfPolicy({ legalBasisTaepsustus: e.target.value })}
                                placeholder="Kirjelda erandi alust"
                                style={{ ...inputStyle, width: "100%" }}
                              />
                            </div>
                            {rfSelectVal === "muu" && (
                              <div style={{ marginTop: 4 }}>
                                <div style={fieldLabel}>Jaotuse kirjeldus</div>
                                <input
                                  value={rfPolicy.allocationBasisMuuKirjeldus || ""}
                                  onChange={(e) => patchRfPolicy({ allocationBasisMuuKirjeldus: e.target.value })}
                                  placeholder="Kirjelda jaotusviisi"
                                  style={{ ...inputStyle, width: "100%" }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Laenuga: panga soovituse info + koefitsiendi väljad */}
                    {ra.onLaen && (
                      <>
                        <div style={{ fontSize: 14, color: N.dim, background: N.muted, borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                          Laenuga: panga soovituse info: remondifond ≥ {(remondifond.pangaKoefitsient || 1.15).toFixed(2).replace(".", ",")}× laenumakse.
                        </div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          <div style={{ width: 160 }}>
                            <div style={{ ...fieldLabel, fontSize: 14 }}>Pangakoefitsient</div>
                            <NumberInput
                              value={remondifond.pangaKoefitsient}
                              onChange={(v) => setRemondifond(p => ({ ...p, pangaKoefitsient: v || 1.15 }))}
                              style={{ ...numStyle, fontSize: 14 }}
                            />
                          </div>
                          <div style={{ width: 160 }}>
                            <div style={{ ...fieldLabel, fontSize: 14 }}>Käsitsi määr €/m²/a</div>
                            <NumberInput
                              value={remondifond.pangaMaarOverride ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, pangaMaarOverride: v > 0 ? v : null }))}
                              placeholder="Automaatne"
                              style={{ ...numStyle, fontSize: 14 }}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {/* ── Fondist rahastatavad tööd ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 16, paddingTop: 12 }}>
                      <div style={H3_STYLE}>Fondist rahastatavad tööd</div>
                      {seisukord.length === 0 ? (
                        <div style={{ fontSize: 14, color: N.sub, padding: "8px 0" }}>
                          Plaanitud töid ei ole lisatud. Mine{" "}
                          <button
                            onClick={() => setSec(1)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#6366f1", padding: 0 }}
                          >
                            Hoone seisukord ja plaanitud tööd
                          </button>
                          {" "}tabisse, et lisada planeeritud tööd.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {seisukord.map(s => {
                            const usageItem = (plan.funds.repairFund.usageItems || []).find(u => u.linkedAssetConditionId === s.id);
                            const itemAmt = parseFloat(String(usageItem?.remondifondistKaetavSumma || "0").replace(",", ".")) || 0;
                            const eeldatavKulu = parseFloat(String(s.eeldatavKulu || "0").replace(",", ".")) || 0;
                            const isOverBudget = eeldatavKulu > 0 && itemAmt > eeldatavKulu;
                            return (
                              <div key={s.id} style={{ padding: 12, background: N.muted, borderRadius: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: N.text }}>{s.ese || "(nimeta töö)"}</div>
                                    {s.plannedYear && <div style={{ fontSize: 12, color: N.dim }}>{s.plannedYear}</div>}
                                  </div>
                                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={!!usageItem}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          addRfUsageItem(mkRfUsageItem({ linkedAssetConditionId: s.id }));
                                        } else {
                                          removeRfUsageItem(usageItem.id);
                                        }
                                      }}
                                    />
                                    Rahastatakse remondifondist
                                  </label>
                                </div>
                                {usageItem && (
                                  <div style={{ marginTop: 8 }}>
                                    <div style={fieldLabel}>Remondifondist kaetav summa</div>
                                    <EuroInput
                                      value={usageItem.remondifondistKaetavSumma}
                                      onChange={(v) => setPlan(p => ({
                                        ...p,
                                        funds: { ...p.funds, repairFund: { ...p.funds.repairFund, usageItems: (p.funds.repairFund.usageItems || []).map(u => u.id === usageItem.id ? { ...u, remondifondistKaetavSumma: v } : u) } },
                                      }))}
                                      style={{ ...numStyle, width: 160 }}
                                    />
                                    {isOverBudget && (
                                      <div style={{ fontSize: 13, color: "#b45309", marginTop: 4 }}>
                                        Sisestatud summa ületab töö eeldatavat maksumust ({euroEE(eeldatavKulu)}).
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ── Fondi suunatud muu tulu ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 16, paddingTop: 12 }}>
                      <div style={fieldLabel}>Fondi suunatud muu tulu</div>
                      <EuroInput
                        value={remondifond.fondiMuuTulu}
                        onChange={(v) => setRemondifond(p => ({ ...p, fondiMuuTulu: v }))}
                        style={{ ...numStyle, width: 160 }}
                        placeholder="0"
                      />
                    </div>

                    {/* ── Investeeringud ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 16, paddingTop: 12 }}>
                      <div style={H3_STYLE}>Investeeringud</div>
                      {ra.invDetail.length > 0 ? (
                        <div style={{ marginBottom: 16 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                            <thead>
                              <tr style={{ color: N.dim, borderBottom: `1px solid ${N.rule}` }}>
                                <th style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>Objekt</th>
                                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Aasta</th>
                                <th style={{ textAlign: "right", padding: "4px 0 4px 8px", fontWeight: 600 }}>RF summa</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ra.invDetail.map((d, i) => (
                                <tr key={i} style={{ color: N.sub }}>
                                  <td style={{ padding: "3px 8px 3px 0" }}>{d.nimetus}</td>
                                  <td style={{ textAlign: "right", padding: "3px 8px", fontFamily: "monospace" }}>{d.aasta}</td>
                                  <td style={{ textAlign: "right", padding: "3px 0 3px 8px", fontFamily: "monospace" }}>{euroEE(d.rfSumma)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ padding: 12, background: N.muted, borderRadius: 6, fontSize: 14, color: N.dim, marginBottom: 16 }}>
                          Investeeringuid pole lisatud.
                        </div>
                      )}
                    </div>

                    {/* ── Lõppsaldo valem ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 8, paddingTop: 12 }}>
                      <div style={H3_STYLE}>Prognoositav remondifondi saldo perioodi lõpus</div>
                      <div style={{ fontFamily: "monospace", fontSize: 14, color: N.sub, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>Remondifondi saldo perioodi alguses</span><span>{euro(ra.saldoAlgus)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>+ Perioodis koguneb</span><span>{euro(ra.laekuminePerioodis)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>+ Fondi suunatud muu tulu</span><span>{euro(ra.fondiMuuTulu)}</span>
                        </div>
                        {ra.rfUsageRemondifondist > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>− Remondifondist kaetavad summad</span><span>{euro(ra.rfUsageRemondifondist)}</span>
                          </div>
                        )}
                        {ra.investRemondifondist > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>− Investeeringud RF-st</span><span>{euro(ra.investRemondifondist)}</span>
                          </div>
                        )}
                        {ra.p2Remondifondist > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>− Tegevuskulud RF-st</span><span>{euro(ra.p2Remondifondist)}</span>
                          </div>
                        )}
                        <div style={{
                          display: "flex", justifyContent: "space-between",
                          borderTop: `1px solid ${N.border}`, paddingTop: 6, marginTop: 8,
                          fontWeight: 600, fontSize: 14,
                          color: ra.saldoLopp >= 0 ? N.text : "#c53030",
                        }}>
                          <span>= Prognoositav remondifondi saldo perioodi lõpus</span><span>{euro(ra.saldoLopp)}</span>
                        </div>
                      </div>

                      {!(hasSoovitud || isSihttaseOpen) && (
                        <button
                          onClick={() => setIsSihttaseOpen(true)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "8px 0", marginTop: 8 }}
                        >
                          Soovin määrata lõppsaldo sihttaseme
                        </button>
                      )}
                      {(hasSoovitud || isSihttaseOpen) && (
                        <div style={{ marginTop: 16 }}>
                          <div style={fieldLabel}>Soovitud minimaalne lõppsaldo perioodi lõpus</div>
                          <EuroInput
                            value={remondifond.soovitudSaldoLopp}
                            onChange={(v) => setRemondifond(p => ({ ...p, soovitudSaldoLopp: v }))}
                            style={{ ...numStyle, width: 160 }}
                          />
                          {hasSoovitud && diff !== null && (
                            <div style={{ marginTop: 8 }}>
                              {diff >= 0 ? (
                                <div style={{ fontSize: 14, color: "#16a34a" }}>
                                  Ülejääk soovitud saldost: {euroEE(diff)}
                                </div>
                              ) : (
                                <div style={{ fontSize: 14, color: "#c53030" }}>
                                  Puudujääk soovitud saldoni: {euroEE(Math.abs(diff))}
                                </div>
                              )}
                              {soovituslikMaar !== null && (
                                <div style={{ marginTop: 8, fontSize: 14, color: N.sub }}>
                                  Soovituslik uus makse määr:{" "}
                                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                                    {soovituslikMaar.toFixed(2).replace(".", ",")} {rfSelectVal === "apartment" ? "€/korter/kuu" : "€/m²/kuu"}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

