/**
 * Couleurs d'encre : les six encres nommées, et les couleurs libres.
 *
 * Un trait enregistre sa couleur en texte. Jusqu'ici c'était toujours un
 * **nom** — « blue », « rose » — que la feuille de style traduit en deux teintes,
 * foncée sur le papier et claire en thème sombre. La roue chromatique ajoute des
 * couleurs **libres**, écrites `#rrggbb` : le format des notes ne change pas, et
 * les notes existantes restent valides.
 *
 * Tout ce qui peint un trait — la couche vive, les tuiles, la vignette, l'export
 * PDF — passe par ce module. Quatre traductions séparées finiraient par ne pas
 * dire la même chose, et une couleur libre sortirait noire à l'export.
 *
 * Module neutre, sans `"use client"` : il sert aussi au serveur (cf. le piège
 * des constantes exportées d'un module client, dans AGENTS.md).
 */

const HEX_STRICT = /^#[0-9a-f]{6}$/;

/**
 * Une couleur libre, déjà normalisée — `#` et six chiffres en minuscules.
 *
 * Stricte à dessein : c'est ce qu'écrit la roue, et rien d'autre ne doit passer
 * pour une couleur libre — ni un nom d'encre, ni une valeur CSS arbitraire.
 */
export function isCustomInk(color: string): boolean {
  return HEX_STRICT.test(color);
}

/**
 * Lit un code saisi à la main : `#d9480f`, `D9480F`, `#f80`…
 *
 * Rend la forme normalisée, ou `null` si ce n'est pas une couleur.
 */
export function parseHex(input: string): string | null {
  const brut = input.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(brut)) {
    return `#${brut
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return /^[0-9a-f]{6}$/.test(brut) ? `#${brut}` : null;
}

/** Composantes de 0 à 1, comme les attend le PDF — ou `null` si ce n'est pas une couleur libre. */
export function hexToRgb01(color: string): [number, number, number] | null {
  if (!isCustomInk(color)) return null;
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Teinte en degrés (0–360), saturation et valeur de 0 à 1 → `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const teinte = ((h % 360) + 360) % 360;
  const composante = (n: number) => {
    const k = (n + teinte / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const octet = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${octet(composante(5))}${octet(composante(3))}${octet(composante(1))}`;
}

/** `#rrggbb` → teinte, saturation et valeur — ou `null` si ce n'est pas une couleur libre. */
export function hexToHsv(color: string): { h: number; s: number; v: number } | null {
  const rgb = hexToRgb01(color);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const ecart = max - Math.min(r, g, b);
  let h = 0;
  if (ecart > 0) {
    if (max === r) h = ((g - b) / ecart) % 6;
    else if (max === g) h = (b - r) / ecart + 2;
    else h = (r - g) / ecart + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : ecart / max, v: max };
}

/** Valeur CSS d'une encre, pour un style en ligne. */
export function inkCss(color: string): string {
  return isCustomInk(color) ? color : `var(--ink-${color})`;
}

/**
 * Couleur à peindre sur un canevas.
 *
 * Une encre nommée se lit dans les styles calculés **de l'élément** : c'est ce
 * qui lui donne sa teinte de papier (`.ink-clair`) ou de thème sombre. Une
 * couleur libre est celle qu'on a choisie, partout.
 */
export function resolveInk(styles: CSSStyleDeclaration, color: string): string {
  if (isCustomInk(color)) return color;
  return styles.getPropertyValue(`--ink-${color}`).trim() || styles.color;
}
