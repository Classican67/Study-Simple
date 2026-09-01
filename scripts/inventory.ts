/**
 * Inventaire de l'installation : combien de contenu, quel poids d'images.
 *
 *   docker compose exec app npx tsx scripts/inventory.ts     (installation Docker)
 *   npx tsx scripts/inventory.ts                             (développement local)
 *
 * Sert à chiffrer une migration avant de la décider. Lit la base **en lecture
 * seule** avec le module SQLite intégré à Node : ni dépendance, ni client
 * Prisma — il fonctionne donc même si le client généré est périmé, ce qui est
 * précisément le cas où l'on a besoin de diagnostiquer.
 */
import { DatabaseSync } from "node:sqlite";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

function databaseFile(): string {
  const url = process.env.DATABASE_URL ?? "file:../data/dev.db";
  if (!url.startsWith("file:")) {
    console.error(`DATABASE_URL n'est pas un fichier SQLite : ${url}`);
    process.exit(1);
  }
  const target = url.slice("file:".length);
  // Prisma résout les chemins relatifs depuis prisma/, pas depuis la racine.
  return path.isAbsolute(target) ? target : path.resolve("prisma", target);
}

function format(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}

async function main() {
  const file = databaseFile();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    console.error(`Base introuvable ou illisible : ${file}`);
    console.error(String(error));
    process.exit(1);
  }

  const count = (table: string): number => {
    try {
      return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
    } catch {
      // Table absente : l'installation est antérieure à la migration qui la crée.
      return -1;
    }
  };

  const label = (n: number) => (n < 0 ? "table absente" : String(n));

  console.log(`\nBase : ${file}`);
  console.log(`Poids du fichier : ${format((await stat(file)).size)}\n`);

  console.log("Contenu");
  for (const table of ["User", "Folder", "Deck", "Card", "CardProgress", "StudySession"]) {
    console.log(`  ${table.padEnd(14)} ${label(count(table)).padStart(6)}`);
  }

  // Répartition des cartes par paquet : utile pour repérer un paquet énorme.
  try {
    const rows = db
      .prepare(
        `SELECT d.title AS titre, COUNT(c.id) AS n
         FROM "Deck" d LEFT JOIN "Card" c ON c."deckId" = d.id
         GROUP BY d.id ORDER BY n DESC LIMIT 8`,
      )
      .all() as { titre: string; n: number }[];
    if (rows.length > 0) {
      console.log("\nPaquets les plus fournis");
      for (const row of rows) {
        console.log(`  ${String(row.n).padStart(5)}  ${row.titre}`);
      }
    }
  } catch {
    // Sans importance : l'inventaire principal suffit.
  }

  // Images référencées en base, et fichiers réellement présents.
  let referenced = 0;
  try {
    referenced = (
      db.prepare(`SELECT COUNT(*) AS n FROM "Card" WHERE "imagePath" IS NOT NULL`).get() as {
        n: number;
      }
    ).n;
  } catch {
    /* table absente */
  }

  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
  let files = 0;
  let bytes = 0;
  try {
    for (const name of await readdir(uploadDir)) {
      const info = await stat(path.join(uploadDir, name)).catch(() => null);
      if (info?.isFile()) {
        files++;
        bytes += info.size;
      }
    }
  } catch {
    console.log(`\n⚠️  Dossier d'images illisible : ${uploadDir}`);
  }

  console.log("\nImages");
  console.log(`  référencées en base   ${String(referenced).padStart(6)}`);
  console.log(`  fichiers sur disque   ${String(files).padStart(6)}`);
  console.log(`  poids total           ${format(bytes).padStart(6)}`);
  console.log(`  dossier               ${uploadDir}`);

  // Un écart signale des fichiers orphelins, ou des images manquantes — à savoir
  // avant toute migration, pour ne pas transporter du vide.
  if (files > referenced) {
    console.log(`\n  ${files - referenced} fichier(s) sans carte associée (orphelins).`);
  } else if (referenced > files) {
    console.log(`\n  ⚠️  ${referenced - files} carte(s) référencent une image absente du disque.`);
  }

  db.close();
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
