import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * L'ordre des copies dans les Dockerfile est fragile et ne se vérifie qu'en
 * construisant l'image — ce que ni un test ni un typecheck ne font.
 *
 * Le piège concret : `package.json` déclare un `postinstall` que npm exécute à
 * la fin de `npm ci`. Tout ce que ce script touche doit donc être déjà dans
 * l'image. Il a fallu `prisma/` d'abord, puis `scripts/` le jour où le
 * `postinstall` s'est mis à copier le worker de pdf.js — et le déploiement a
 * échoué sur « Cannot find module /app/scripts/copy-pdf-worker.mjs ».
 *
 * Le contrôle ci-dessous ne nomme donc aucun dossier : il **relit** la ligne
 * de `postinstall` et exige que chaque chemin qui y figure soit copié avant
 * l'installation. Ajouter un script au `postinstall` sans toucher au
 * Dockerfile fait désormais échouer le test, pas le déploiement.
 */

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

/** Numéro de la première ligne satisfaisant le motif, ou -1. */
function lineOf(content: string, pattern: RegExp): number {
  return content.split("\n").findIndex((line) => pattern.test(line.trim()));
}

describe("postinstall", () => {
  it("génère le client Prisma après chaque installation", () => {
    // C'est ce qui évite un client périmé après un `git pull` apportant un
    // nouveau champ — et c'est aussi ce qui impose l'ordre testé plus bas.
    assert.match(packageJson.scripts.postinstall ?? "", /prisma generate/);
  });
});

/**
 * Les dossiers que le `postinstall` doit trouver dans l'image.
 *
 * On y lit les chemins de fichiers — `scripts/copy-pdf-worker.mjs` — et on n'en
 * garde que le premier segment, celui que le Dockerfile copie.
 */
function dossiersRequis(script: string): string[] {
  const chemins = script.match(/(?<![\w./-])[\w.-]+\/[\w./-]+/g) ?? [];
  const dossiers = chemins
    .filter((chemin) => !chemin.startsWith("http"))
    .map((chemin) => chemin.split("/")[0]);
  // `prisma generate` ne nomme pas son schéma : il le cherche dans prisma/.
  if (/prisma generate/.test(script)) dossiers.push("prisma");
  return [...new Set(dossiers)];
}

describe("ce que le postinstall réclame", () => {
  it("se déduit de la ligne elle-même", () => {
    assert.deepEqual(dossiersRequis("prisma generate && node scripts/x.mjs").sort(), [
      "prisma",
      "scripts",
    ]);
  });
});

for (const file of ["Dockerfile", "Dockerfile.dev"]) {
  describe(file, () => {
    const content = readFileSync(file, "utf8");

    it("copie avant `npm ci` tout ce que le postinstall réclame", () => {
      const install = lineOf(content, /^RUN\s+npm ci\b/);
      assert.notEqual(install, -1, "aucun `npm ci`");

      for (const dossier of dossiersRequis(packageJson.scripts.postinstall ?? "")) {
        const copie = lineOf(content, new RegExp(`^COPY\\s+${dossier}\\b`));
        assert.notEqual(copie, -1, `${dossier}/ n'est jamais copié — le postinstall échouera`);
        assert.ok(
          copie < install,
          `${dossier}/ est copié après \`npm ci\`, qui en a besoin pendant`,
        );
      }
    });

    it("copie prisma/ avant d'installer les dépendances", () => {
      const copyPrisma = lineOf(content, /^COPY\s+prisma\b/);
      const install = lineOf(content, /^RUN\s+npm ci\b/);

      assert.notEqual(copyPrisma, -1, "aucune copie de prisma/");
      assert.notEqual(install, -1, "aucun npm ci");
      assert.ok(
        copyPrisma < install,
        `COPY prisma (ligne ${copyPrisma + 1}) doit précéder RUN npm ci (ligne ${install + 1}) : ` +
          "sinon le postinstall ne trouve pas le schéma et npm ci échoue.",
      );
    });

    it("copie le manifeste avant prisma/, pour garder le cache utile", () => {
      // package-lock.json change moins souvent que le schéma : le placer en
      // premier maximise la réutilisation de la couche d'installation.
      const copyManifest = lineOf(content, /^COPY\s+package\.json/);
      const copyPrisma = lineOf(content, /^COPY\s+prisma\b/);
      assert.ok(copyManifest < copyPrisma);
    });
  });
}

describe(".dockerignore", () => {
  it("n'exclut pas prisma/, sinon la copie serait vide", () => {
    // Une exclusion ici produirait exactement la même panne, mais sans qu'aucune
    // ligne du Dockerfile ne paraisse fautive.
    const ignored = readFileSync(".dockerignore", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    assert.ok(!ignored.some((line) => /^\/?prisma\/?$/.test(line)));
  });
});
