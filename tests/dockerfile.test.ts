import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * L'ordre des copies dans les Dockerfile est fragile et ne se vérifie qu'en
 * construisant l'image — ce que ni un test ni un typecheck ne font.
 *
 * Le piège concret : `package.json` déclare un `postinstall` qui lance
 * `prisma generate`. npm l'exécute à la fin de `npm ci`. Si le dossier
 * `prisma/` n'a pas encore été copié à ce moment-là, la génération échoue et
 * fait échouer `npm ci` — donc tout le build.
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

for (const file of ["Dockerfile", "Dockerfile.dev"]) {
  describe(file, () => {
    const content = readFileSync(file, "utf8");

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
