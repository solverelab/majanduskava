            {(() => {
              const rkSaldoAlgus = parseFloat(resKap.saldoAlgus) || 0;
              const rkKogumine = plan.funds.reserve.plannedEUR || 0; // funds.reserve, plannedEUR
              const rkKasutamine = resKap.usesReserveDuringPeriod ? (parseFloat(resKap.kasutamine) || 0) : 0;
              const rkSaldoLopp = rkSaldoAlgus + rkKogumine - rkKasutamine;
              const noutavMinimum = reserveMin.noutavMiinimum || 0;
              const vastab = rkSaldoLopp >= noutavMinimum;
              const puudu = Math.max(0, noutavMinimum - rkSaldoLopp);
              const soovituslikKogumine = Math.max(0, noutavMinimum + rkKasutamine - rkSaldoAlgus);
              const mEq = derived.period.monthEq || 12;
              const koguPind = derived.building.totAreaM2 || 0;
              const rkMaarKuusM2 = koguPind > 0 ? rkKogumine / mEq / koguPind : 0;
              const rkRow = { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 14 };
              return (
                <div style={card}>
                  <div style={{ ...H2_STYLE, marginTop: 0, marginBottom: 16 }}>Reservkapital</div>

                  {/* ── Algseis ── */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={H3_STYLE}>Algseis</div>
                    <div style={{ width: 200 }}>
                      <div style={fieldLabel}>Saldo perioodi alguses</div>
                      <EuroInput value={resKap.saldoAlgus} onChange={(v) => { setResKapManual(true); setResKap(p => ({ ...p, saldoAlgus: v })); }} style={numStyle} />
                    </div>
                  </div>

                  {/* ── Kogumine perioodis ── */}
                  <div style={{ borderTop: `1px solid ${N.border}`, paddingTop: 12, marginBottom: 16 }}>
                    <div style={H3_STYLE}>Kogumine perioodis</div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
                      <div style={{ width: 200 }}>
                        <div style={fieldLabel}>Planeeritud kogumine</div>
                        <EuroInput
                          value={rkKogumine}
                          onChange={(v) => {
                            setResKapManual(true);
                            setPlan(p => ({ ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: v } } }));
                          }}
                          style={numStyle}
                        />
                        {resKapManual && (
                          <button
                            onClick={() => setResKapManual(false)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "4px 0", marginTop: 4 }}
                          >
                            ↻ Automaatne
                          </button>
                        )}
                      </div>
                      {koguPind > 0 && rkKogumine > 0 && (
                        <div style={{ fontSize: 14, color: N.sub, paddingBottom: 6 }}>
                          {rkMaarKuusM2.toFixed(2).replace(".", ",")} €/m²/kuu
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: N.dim, marginTop: 8 }}>
                      KrtS § 48 miinimumnõue: vähemalt 1/12 aastakuludest ({euro(reserveMin.noutavMiinimum)})
                    </div>
                    {(() => {
                      const desc = describeAllocationPolicy(plan.allocationPolicies?.reserve);
                      return (
                        <div style={{ fontSize: 12, color: N.dim, marginTop: 4 }}>
                          Jaotusalus: {desc.basisLabel}
                          {desc.hasOverride
                            ? ` · Õiguslik alus: ${desc.legalBasis}${desc.legalBasisNote ? " — " + desc.legalBasisNote : ""}`
                            : " · Kaasomandi osa suuruse alusel"}
                        </div>
                      );
                    })()}
                    {renderPolicyException("reserve")}
                  </div>

                  {/* ── Kasutamine perioodis (toggle) ── */}
                  <div style={{ borderTop: `1px solid ${N.border}`, paddingTop: 12, marginBottom: 16 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!resKap.usesReserveDuringPeriod}
                        onChange={(e) => setResKap(p => ({ ...p, usesReserveDuringPeriod: e.target.checked }))}
                      />
                      Kas reservkapitalist kasutatakse perioodis raha?
                    </label>
                    {resKap.usesReserveDuringPeriod && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ width: 200 }}>
                          <div style={fieldLabel}>Reservkapitalist kasutatav summa perioodis</div>
                          <EuroInput value={resKap.kasutamine} onChange={(v) => setResKap(p => ({ ...p, kasutamine: v }))} style={numStyle} />
                        </div>
                        {rkKasutamine > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <textarea
                              value={resKap.pohjendus}
                              onChange={(e) => setResKap(p => ({ ...p, pohjendus: e.target.value }))}
                              placeholder="Põhjendage erakorralised kulud"
                              rows={2}
                              style={{ ...inputStyle, width: "100%", fontSize: 14, padding: 8, border: `1px solid ${resKap.pohjendus ? N.border : N.sub}`, borderRadius: 6 }}
                            />
                            {!resKap.pohjendus && (
                              <div style={{ fontSize: 14, color: N.sub, marginTop: 8 }}>Põhjendus on soovitav</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Lõppseis ── */}
                  <div style={{ borderTop: `1px solid ${N.border}`, paddingTop: 12 }}>
                    <div style={H3_STYLE}>Reservi seis perioodi lõpus</div>

                    <div style={{ fontFamily: "monospace", fontSize: 14, color: N.sub, display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Saldo perioodi alguses</span><span>{euro(rkSaldoAlgus)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>+ Kogumine perioodis</span><span>{euro(rkKogumine)}</span>
                      </div>
                      {rkKasutamine > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>− Erakorraline kasutamine</span><span>{euro(rkKasutamine)}</span>
                        </div>
                      )}
                      <div style={{
                        display: "flex", justifyContent: "space-between",
                        borderTop: `1px solid ${N.border}`, paddingTop: 6, marginTop: 4,
                        fontWeight: 600, fontSize: 14,
                        color: rkSaldoLopp < 0 ? "#c53030" : N.text,
                      }}>
                        <span>Prognoositav lõppsaldo</span>
                        <span style={{ fontFamily: "monospace" }}>{euroEE(rkSaldoLopp)}</span>
                      </div>
                    </div>

                    {vastab ? (
                      <div style={{ fontSize: 14, color: "#16a34a", fontWeight: 500, marginBottom: 8 }}>
                        Nõutav miinimum on täidetud.
                      </div>
                    ) : (
                      <div style={{ padding: 12, background: "#fef3c7", borderRadius: 6, fontSize: 14, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, color: "#92400e" }}>
                          Hoiatus: prognoositav lõppsaldo jääb alla nõutava miinimumi
                        </div>
                        <div style={{ marginTop: 6, color: N.text }}>
                          Puudu nõutava miinimumini: {euroEE(puudu)}
                        </div>
                        <div style={{ marginTop: 4, color: N.sub }}>
                          Soovituslik minimaalne kogumine perioodis: {euroEE(soovituslikKogumine)}
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: 13, color: N.dim }}>
                      Nõutav miinimum (1/12 aastakuludest): {euro(noutavMinimum)}
                    </div>
                  </div>
                </div>
              );
            })()}

