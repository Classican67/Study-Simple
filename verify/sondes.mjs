/*
 * Les sondes de `audit.mjs` — contraste WCAG, cibles tactiles, positions —,
 * partagées avec les scénarios qui visitent des états qu'audit ne voit pas.
 * Chacune est une expression auto-appelée, à passer telle quelle à
 * `page.evaluate` (une fonction passée en chaîne n'y serait jamais appelée).
 */
// Chromium renvoie les couleurs calculées en `oklch()`. Les lire comme du RGB
// donne des rapports absurdes : on passe par un canevas, qui les convertit.
export const CONTRAST = `
(() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toRgb = (color) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
    }
    return getComputedStyle(document.body).backgroundColor || "#fff";
  };

  const out = [];
  for (const el of document.querySelectorAll("h1,h2,h3,p,span,a,button,label,li,dd,dt,kbd,td,th,input")) {
    // La propriete value n'est une chaine que sur un champ de saisie : sur un
    // li, c'est un nombre, et trim() n'y existe pas.
    const brut = el instanceof HTMLInputElement ? el.value : el.textContent;
    const text = String(brut ?? "").trim();
    if (!text || el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const value = ratio(toRgb(cs.color), toRgb(bgOf(el)));
    if (value < need) out.push({ text: text.slice(0, 30), ratio: value.toFixed(2), need });
  }
  return out;
})()
`;

export const TOUCH = `
(() => {
  const out = [];
  for (const el of document.querySelectorAll("button,a,[role=button],input[type=checkbox],[role=switch]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || cs.pointerEvents === "none") continue;
    // La cible, au sens de WCAG, est la zone qui ACTIVE le contrôle. Une case
    // de 20 px enveloppee dans une etiquette pleine largeur se coche en
    // touchant l'etiquette : c'est elle qu'il faut mesurer.
    let zone = r;
    if (el.tagName === "INPUT") {
      const etiquette = el.closest("label") || document.querySelector('label[for="' + el.id + '"]');
      if (etiquette) {
        const er = etiquette.getBoundingClientRect();
        if (er.width * er.height > zone.width * zone.height) zone = er;
      }
    }

    if (zone.width < 44 || zone.height < 44) {
      out.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30),
        size: Math.round(zone.width) + "x" + Math.round(zone.height),
      });
    }
  }
  return out;
})()
`;

export const POSITION = `
(() => {
  const out = [];
  const attendu = { absolute: "absolute", fixed: "fixed", sticky: "sticky", relative: "relative" };
  for (const el of document.querySelectorAll("[class]")) {
    const classes = (el.getAttribute("class") || "").split(/\\s+/);
    const voulu = classes.map((c) => attendu[c]).filter(Boolean).pop();
    if (!voulu) continue;
    const reel = getComputedStyle(el).position;
    if (reel !== voulu) {
      out.push({
        voulu,
        reel,
        label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30),
      });
    }
  }
  return out;
})()
`;

