import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRange } from "@/lib/upload-path";

/**
 * Requêtes par plage sur les fichiers téléversés.
 *
 * Sans elles, pdf.js n'a pas le choix : il télécharge le document **en entier**
 * avant d'afficher la première page. Sur iPad, ouvrir un polycopié scanné de
 * trente mégaoctets ressemblait alors à un blocage — l'écran restait blanc tout
 * le temps du téléchargement, et l'on croyait l'import raté.
 *
 * L'interprétation de l'en-tête est la partie qui se trompe en silence : une
 * borne mal calculée rend un octet de trop ou de moins, et le lecteur signale
 * un « fichier corrompu » sans dire lequel.
 */
describe("parseRange", () => {
  it("rend null sans en-tête : c'est une requête ordinaire", () => {
    assert.equal(parseRange(null, 1000), null);
  });

  it("lit une plage fermée", () => {
    assert.deepEqual(parseRange("bytes=0-499", 1000), { debut: 0, fin: 499 });
    assert.deepEqual(parseRange("bytes=500-999", 1000), { debut: 500, fin: 999 });
  });

  it("ramène une fin absente au dernier octet du fichier", () => {
    // C'est la forme que pdf.js utilise pour la dernière plage d'un document,
    // là où se trouve la table des objets.
    assert.deepEqual(parseRange("bytes=900-", 1000), { debut: 900, fin: 999 });
  });

  it("ramène une fin au-delà du fichier au dernier octet", () => {
    // Exigé par la RFC : demander plus que le fichier n'est pas une erreur.
    assert.deepEqual(parseRange("bytes=900-5000", 1000), { debut: 900, fin: 999 });
  });

  it("lit une plage comptée depuis la fin", () => {
    assert.deepEqual(parseRange("bytes=-500", 1000), { debut: 500, fin: 999 });
    // Plus longue que le fichier : on rend le fichier, pas un début négatif.
    assert.deepEqual(parseRange("bytes=-5000", 1000), { debut: 0, fin: 999 });
  });

  it("refuse une plage qui commence hors du fichier", () => {
    assert.equal(parseRange("bytes=1000-1200", 1000), "invalide");
    assert.equal(parseRange("bytes=2000-", 1000), "invalide");
  });

  it("refuse une plage à l'envers, et le suffixe vide", () => {
    assert.equal(parseRange("bytes=500-100", 1000), "invalide");
    assert.equal(parseRange("bytes=-", 1000), "invalide");
    assert.equal(parseRange("bytes=-0", 1000), "invalide");
  });

  it("ignore ce qu'il ne sait pas faire plutôt que d'échouer", () => {
    // Plusieurs plages, ou une unité exotique : répondre 200 est correct, et
    // tout client s'en accommode. Faire du multipart coûterait plus que ça ne
    // rapporte.
    assert.equal(parseRange("bytes=0-99,200-299", 1000), null);
    assert.equal(parseRange("items=0-99", 1000), null);
  });

  it("compte le dernier octet, jamais un de plus", () => {
    const plage = parseRange("bytes=0-", 10);
    assert.deepEqual(plage, { debut: 0, fin: 9 });
    // La longueur annoncée dans `Content-Length` se déduit ainsi : une erreur
    // d'un octet ici fait dire au lecteur que le PDF est corrompu.
    // `deepEqual` a déjà restreint le type : il ne reste que la plage.
    assert.equal(plage.fin - plage.debut + 1, 10);
  });
});
