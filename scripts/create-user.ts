/**
 * Création (ou réinitialisation) d'un compte en ligne de commande.
 *
 * C'est le seul moyen de créer le tout premier administrateur, la page /admin
 * exigeant déjà d'être connecté en tant qu'admin.
 *
 *   npm run user:create -- --email toi@exemple.com --name Toi --admin
 *
 * Trois façons de fournir le mot de passe, dans cet ordre de priorité :
 *   1. la variable d'environnement FICHES_PASSWORD (scripts, Docker) ;
 *   2. l'entrée standard si elle est redirigée (echo 'secret' | npm run …) ;
 *   3. une saisie interactive masquée, avec confirmation.
 *
 * Le mot de passe n'est jamais passé en argument : argv est visible dans
 * l'historique du shell et dans la liste des processus.
 */
import { createInterface, type Interface } from "node:readline";
import { stdin, stdout } from "node:process";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

// readline n'expose pas officiellement le contrôle de l'écho ; `_writeToOutput`
// est le point d'accroche habituel pour masquer une saisie.
type MutableInterface = Interface & { _writeToOutput?: (text: string) => void };

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true }) as MutableInterface;

    rl._writeToOutput = (text: string) => {
      // On laisse passer l'invite, on remplace la frappe par des astérisques.
      if (text.includes(prompt)) stdout.write(text);
      else if (text.trim().length > 0) stdout.write("*");
    };

    rl.question(prompt, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => (data += chunk));
    stdin.on("end", () => resolve(data.split("\n")[0].trim()));
  });
}

async function resolvePassword(email: string): Promise<string> {
  const fromEnv = process.env.FICHES_PASSWORD;
  if (fromEnv) return fromEnv;

  // Entrée redirigée : pas de confirmation possible, on prend la première ligne.
  if (!stdin.isTTY) return readStdin();

  const password = await askHidden(`Mot de passe pour ${email} : `);
  const confirm = await askHidden("Confirme le mot de passe : ");
  if (password !== confirm) {
    console.error("Les deux saisies ne correspondent pas.");
    process.exit(1);
  }
  return password;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const isAdmin = process.argv.includes("--admin");

  if (!email || !name) {
    console.error("Usage : npm run user:create -- --email <courriel> --name <nom> [--admin]");
    process.exit(1);
  }

  const password = await resolvePassword(email);
  if (password.length < 8) {
    console.error("Mot de passe trop court (8 caractères minimum).");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const role = isAdmin ? "admin" : "user";

  // upsert plutôt que create : relancer la commande sur un compte existant
  // vaut réinitialisation du mot de passe, ce qui est bien pratique.
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role },
    update: { name, passwordHash, role },
  });

  console.log(`✅ Compte ${role} prêt : ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
