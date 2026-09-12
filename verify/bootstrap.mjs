/*
 * Régénère ctx.json (jeton de session + identifiants de test).
 * Le dossier temporaire est nettoyé par le système sans prévenir : relancer
 * `node bootstrap.mjs` remet les scripts de vérification en état de marche.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SignJWT } from "jose";

const RACINE = new URL("..", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${RACINE}/.env`, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);

const db = new DatabaseSync(`${RACINE}/data/dev.db`, { readOnly: true });
const user = db.prepare(`SELECT id, email, role FROM "User" LIMIT 1`).get();
const deck =
  db.prepare(`SELECT id FROM "Deck" WHERE title = 'Biologie cellulaire'`).get() ??
  db.prepare(`SELECT id FROM "Deck" LIMIT 1`).get();
// Un dossier de **paquets** : `/folders/<id>` est la route des paquets, et un
// dossier de notes y répond 404 depuis que les deux classements sont séparés.
const folder = db.prepare(`SELECT id FROM "Folder" WHERE kind = 'deck' LIMIT 1`).get();
const noteFolder = db.prepare(`SELECT id FROM "Folder" WHERE kind = 'note' LIMIT 1`).get();
db.close();

const token = await new SignJWT({ userId: user.id, role: user.role })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(new TextEncoder().encode(env.SESSION_SECRET));

writeFileSync(
  "ctx.json",
  JSON.stringify(
    {
      token,
      userId: user.id,
      email: user.email,
      deckId: deck.id,
      folderId: folder?.id ?? null,
      noteFolderId: noteFolder?.id ?? null,
    },
    null,
    2,
  ),
);
console.log("ctx.json régénéré —", user.email, "| paquet", deck.id, "| dossier", folder?.id ?? "(aucun)");
