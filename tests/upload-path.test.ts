import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_UPLOAD_BYTES,
  contentTypeFor,
  extensionFor,
  isDocumentType,
  isValidUploadName,
  needsConversion,
} from "@/lib/upload-path";

const valide = "9d4a4cfe-aa4e-4cbb-8b5f-4002367a815f.png";

describe("isValidUploadName", () => {
  it("accepte un nom produit par l'application", () => {
    assert.equal(isValidUploadName(valide), true);
    assert.equal(isValidUploadName(valide.replace(".png", ".webp")), true);
  });

  it("refuse toute forme de traversée de chemin", () => {
    // La validation est une liste blanche : ces cas sont écartés d'office.
    for (const attaque of [
      "../.env",
      "..%2F.env",
      "sub/dir.png",
      "..\\windows.png",
      "/etc/passwd",
      "a\0b.png",
      "",
    ]) {
      assert.equal(isValidUploadName(attaque), false, JSON.stringify(attaque));
    }
  });

  it("refuse une extension hors liste blanche", () => {
    assert.equal(isValidUploadName(valide.replace(".png", ".svg")), false);
    assert.equal(isValidUploadName(valide.replace(".png", ".html")), false);
  });

  it("refuse un nom qui n'est pas un UUID", () => {
    assert.equal(isValidUploadName("photo.png"), false);
    assert.equal(isValidUploadName("../9d4a4cfe-aa4e-4cbb-8b5f-4002367a815f.png"), false);
  });
});

describe("extensionFor", () => {
  it("impose l'extension à partir du type MIME accepté", () => {
    assert.equal(extensionFor("image/png"), ".png");
    assert.equal(extensionFor("image/jpeg"), ".jpg");
  });

  it("refuse un type non autorisé", () => {
    // Le SVG est un vecteur de script : jamais accepté.
    assert.equal(extensionFor("image/svg+xml"), undefined);
    assert.equal(extensionFor("text/html"), undefined);
  });
});

describe("contentTypeFor", () => {
  it("retrouve le type MIME depuis l'extension", () => {
    assert.equal(contentTypeFor(valide), "image/png");
    assert.equal(contentTypeFor("x.WEBP"), "image/webp");
  });

  it("retombe sur un type neutre pour l'inconnu", () => {
    assert.equal(contentTypeFor("x.exe"), "application/octet-stream");
  });
});

describe("limites", () => {
  it("plafonne la taille à 8 Mo", () => {
    assert.equal(MAX_UPLOAD_BYTES, 8 * 1024 * 1024);
  });
});

describe("documents annotables", () => {
  it("accepte le PDF et les formats qu'on sait convertir", () => {
    for (const type of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/vnd.oasis.opendocument.text",
    ]) {
      assert.equal(isDocumentType(type), true, type);
    }
  });

  it("refuse tout le reste", () => {
    for (const type of ["application/zip", "text/html", "application/x-msdownload", ""]) {
      assert.equal(isDocumentType(type), false, type);
    }
  });

  it("sait ce qui demande une conversion", () => {
    // Le PDF est stocké tel quel ; le reste passe par LibreOffice.
    assert.equal(needsConversion("application/pdf"), false);
    assert.equal(
      needsConversion("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      true,
    );
    // Un type inconnu n'est pas « à convertir » : il est refusé plus haut.
    assert.equal(needsConversion("application/zip"), false);
  });

  it("reconnaît un PDF stocké comme nom valide", () => {
    const nom = "0f8fad5b-d9cb-469f-a165-70867728950e.pdf";
    assert.equal(isValidUploadName(nom), true);
    assert.equal(contentTypeFor(nom), "application/pdf");
  });

  it("refuse toujours ce qui n'est pas un nom produit par l'app", () => {
    for (const mauvais of ["../secret.pdf", "fichier.pdf", "0f8fad5b.pdf", "x.exe"]) {
      assert.equal(isValidUploadName(mauvais), false, mauvais);
    }
  });
});
