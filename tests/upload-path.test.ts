import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_UPLOAD_BYTES,
  contentTypeFor,
  extensionFor,
  isValidUploadName,
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
