import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  csvField,
  exportFilename,
  isExportFormat,
  toCsv,
  toTsv,
  tsvField,
  UTF8_BOM,
} from "@/lib/export";

describe("csvField", () => {
  it("laisse tel quel ce qui n'a rien de spécial", () => {
    assert.equal(csvField("Mitose"), "Mitose");
    assert.equal(csvField("Élève modèle"), "Élève modèle");
  });

  it("entoure et double les guillemets", () => {
    assert.equal(csvField('Il a dit "oui"'), '"Il a dit ""oui"""');
  });

  it("entoure ce qui contient un séparateur ou un saut de ligne", () => {
    assert.equal(csvField("a,b"), '"a,b"');
    assert.equal(csvField("a\nb"), '"a\nb"');
    assert.equal(csvField("a\r\nb"), '"a\r\nb"');
  });
});

describe("toCsv", () => {
  it("assemble en CRLF, comme l'attendent les tableurs", () => {
    assert.equal(toCsv([["a", "b"], ["c", "d"]]), "a,b\r\nc,d");
  });

  it("reste relisible quand tout est piégeux", () => {
    // On relit ce qu'on vient d'écrire : c'est la seule preuve qui vaille.
    const rows = [
      ["Terme", "Définition"],
      ['Guillemet "', "Virgule , et\nsaut"],
    ];
    const parsed = parseCsv(toCsv(rows));
    assert.deepEqual(parsed, rows);
  });
});

describe("tsvField", () => {
  it("neutralise ce qui casserait la structure", () => {
    // Une tabulation dans un terme ferait une colonne de trop.
    assert.equal(tsvField("a\tb"), "a b");
    assert.equal(tsvField("a\nb"), "a b");
    assert.equal(tsvField("  a\r\n\r\nb  "), "a b");
  });

  it("produit un fichier relisible par l'import de l'app", () => {
    const texte = toTsv([
      { term: "Mitose", definition: "Division cellulaire" },
      { term: "Avec\ttab", definition: "Avec\nsaut" },
    ]);
    const lignes = texte.split("\n");
    assert.equal(lignes.length, 2);
    for (const ligne of lignes) {
      assert.equal(ligne.split("\t").length, 2, `« ${ligne} » doit avoir deux colonnes`);
    }
  });
});

describe("exportFilename", () => {
  it("date le fichier pour que deux exports ne se remplacent pas", () => {
    assert.equal(exportFilename("csv", new Date("2026-09-10T12:00:00")), "fiches-2026-09-10.csv");
    assert.equal(exportFilename("json", new Date("2026-01-05T12:00:00")), "fiches-2026-01-05.json");
  });
});

describe("isExportFormat", () => {
  it("n'accepte que les formats connus", () => {
    for (const bon of ["json", "csv", "txt"]) assert.equal(isExportFormat(bon), true);
    for (const mauvais of ["", "xlsx", "JSON", null, 1, {}]) {
      assert.equal(isExportFormat(mauvais), false, String(mauvais));
    }
  });
});

describe("UTF8_BOM", () => {
  it("est bien la marque d'ordre d'octets, et rien d'autre", () => {
    // Sans elle, Excel sous Windows affiche « Ã‰lÃ¨ve » au lieu de « Élève ».
    assert.equal(UTF8_BOM.length, 1);
    assert.equal(UTF8_BOM.codePointAt(0), 0xfeff);
  });
});

/** Analyseur CSV minimal, uniquement pour vérifier ce que l'on produit. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}
