import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Le client Prisma généré doit connaître toutes les colonnes du schéma.
 *
 * Un client périmé ne casse ni la compilation ni le reste des tests : il
 * échoue à l'exécution, avec un message obscur — « Unknown field `sourceCardId`
 * for select statement on model `Card` ». C'est arrivé deux fois, sur deux
 * champs différents. Ce contrôle compare le schéma au client généré, et coûte
 * une lecture de fichier.
 */
const RACINE = process.cwd();
const SCHEMA = path.join(RACINE, "prisma/schema.prisma");
const CLIENT = path.join(RACINE, "node_modules/.prisma/client/index.d.ts");

/** Champs scalaires déclarés dans le schéma, modèle par modèle. */
function champsDuSchema(schema: string): string[] {
  const champs: string[] = [];
  for (const match of schema.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const [, modele, corps] = match;
    for (const ligne of corps.split("\n")) {
      const m = /^\s*(\w+)\s+(String|Int|Boolean|DateTime|Float)(\?|\[\])?/.exec(ligne);
      if (m) champs.push(`${modele}.${m[1]}`);
    }
  }
  return champs;
}

describe("client Prisma", () => {
  it("connaît tous les champs du schéma", () => {
    assert.ok(existsSync(SCHEMA), "schema.prisma introuvable");
    // Sur une installation neuve, le client n'est généré qu'au postinstall.
    if (!existsSync(CLIENT)) {
      assert.fail("Client Prisma absent. Lance `npx prisma generate`.");
    }

    const client = readFileSync(CLIENT, "utf8");
    const manquants = champsDuSchema(readFileSync(SCHEMA, "utf8")).filter(
      (champ) => !new RegExp(`\\b${champ.split(".")[1]}\\b`).test(client),
    );

    assert.deepEqual(
      manquants,
      [],
      `Client Prisma périmé. Lance \`npx prisma generate\`, puis redémarre le serveur.`,
    );
  });

  it("repère un schéma dont un modèle manque au client", () => {
    // Le contrôle ci-dessus ne vaut que s'il sait échouer.
    const faux = champsDuSchema(`model Card {\n  champInvente String\n}`);
    assert.deepEqual(faux, ["Card.champInvente"]);
    assert.ok(!/\bchampInvente\b/.test(readFileSync(CLIENT, "utf8")));
  });
});
