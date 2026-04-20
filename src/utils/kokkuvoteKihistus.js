export function computeKokkuvoteKihistus({ korteriteKuumaksed }) {
  return korteriteKuumaksed.map(k => {
    const components = [
      { key: "kommunaal",   label: "Kommunaal",   eur: k.kommunaal },
      { key: "haldus",      label: "Haldus",      eur: k.haldus },
      { key: "remondifond", label: "Remondifond", eur: k.remondifond },
      { key: "laenumakse",  label: "Laenumakse",  eur: k.laenumakse },
      { key: "reserv",      label: "Reserv",      eur: k.reserv },
    ].filter(c => c.eur > 0);

    const total = components.reduce((s, c) => s + c.eur, 0);

    const withShare = components.map(c => ({
      ...c,
      share: total > 0 ? c.eur / total : 0,
    }));

    const topMojutajad = [...withShare]
      .sort((a, b) => b.eur - a.eur)
      .slice(0, 3);

    const eurPerM2 = k.pind > 0 ? total / k.pind : 0;

    return {
      aptId: k.id,
      tahis: k.tahis,
      pind: k.pind,
      total,
      eurPerM2,
      components: withShare,
      topMojutajad,
      laenTingimuslik: k.laenTingimuslik || 0,
    };
  });
}
