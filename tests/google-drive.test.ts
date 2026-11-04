import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { nomDeFichier, planifier, type Connu, type Voulu } from "../src/lib/google-drive/plan";
import { ouvrir, sceller } from "../src/lib/google-drive/coffre";
import { noteMarkdown } from "../src/lib/google-drive/markdown";

const dossier = (key: string, parent: string, name = key): Voulu => ({ key, name, parent, version: "", dossier: true });
const fichier = (key: string, parent: string, version = "v1", name = key): Voulu => ({
  key,
  name,
  parent,
  version,
  dossier: false,
});
const connu = (v: Voulu, driveId = `id-${v.key}`): Connu => ({
  key: v.key,
  driveId,
  version: v.version,
  name: v.name,
  parent: v.parent,
});

describe("plan de synchronisation", () => {
  const arbre = [
    fichier("note:1:pdf", "folder:b"),
    dossier("folder:b", "folder:a"),
    dossier("folder:a", "notes"),
    dossier("notes", "root"),
    dossier("root", ""),
  ];

  it("crée les dossiers du haut vers le bas, puis les fichiers", () => {
    const gestes = planifier(arbre, []);
    assert.deepEqual(
      gestes.map((g) => (g.type === "jeter" ? g.connu.key : `${g.type} ${g.voulu.key}`)),
      ["creer root", "creer notes", "creer folder:a", "creer folder:b", "creer note:1:pdf"],
    );
  });

  it("ne fait rien quand tout est à jour", () => {
    assert.deepEqual(planifier(arbre, arbre.map((v) => connu(v))), []);
  });

  it("renvoie un contenu changé, déplace sans renvoyer un fichier seulement rangé ailleurs", () => {
    const connus = arbre.map((v) => connu(v));
    const change = planifier(
      arbre.map((v) => (v.key === "note:1:pdf" ? { ...v, version: "v2" } : v)),
      connus,
    );
    assert.deepEqual(change.map((g) => g.type), ["remplacer"]);
    const range = planifier(
      arbre.map((v) => (v.key === "note:1:pdf" ? { ...v, parent: "folder:a" } : v)),
      connus,
    );
    assert.deepEqual(range.map((g) => g.type), ["deplacer"]);
    const renomme = planifier(
      arbre.map((v) => (v.key === "folder:a" ? { ...v, name: "Biologie" } : v)),
      connus,
    );
    assert.deepEqual(range.length + renomme.length, 2);
    assert.equal(renomme[0].type, "deplacer");
  });

  it("jette les fichiers d'abord, puis les dossiers du plus profond au moins profond", () => {
    // Le dossier b disparaît, mais sa note est rangée ailleurs : elle doit être
    // déplacée AVANT que b parte à la corbeille, sinon elle partirait avec lui.
    const connus = arbre.map((v) => connu(v));
    const voulus = [
      fichier("note:1:pdf", "folder:a"),
      dossier("folder:a", "notes"),
      dossier("notes", "root"),
      dossier("root", ""),
    ];
    const gestes = planifier(voulus, [...connus, connu(fichier("note:2:pdf", "folder:b"))]);
    const ordre = gestes.map((g) => (g.type === "jeter" ? `jeter ${g.connu.key}` : `${g.type} ${g.voulu.key}`));
    assert.deepEqual(ordre, ["deplacer note:1:pdf", "jeter note:2:pdf", "jeter folder:b"]);
  });

  it("ne jette jamais ce qui est encore voulu", () => {
    const connus = arbre.map((v) => connu(v));
    for (const g of planifier(arbre.slice(1), connus)) {
      if (g.type === "jeter") assert.equal(g.connu.key, "note:1:pdf");
    }
  });
});

describe("nom de fichier", () => {
  it("retire ce qu'un disque refuse et retombe sur un repli", () => {
    assert.equal(nomDeFichier("Cours 3 : la cellule / suite", ".pdf", "Note"), "Cours 3 la cellule suite.pdf");
    assert.equal(nomDeFichier("   ", ".md", "Note"), "Note.md");
    assert.equal(nomDeFichier("x".repeat(300), "", "N").length, 120);
  });
});

describe("coffre du jeton Google", () => {
  const secret = "un-secret-de-session-assez-long-pour-servir-ici";

  it("rouvre ce qu'il a scellé, et ne le garde pas en clair", () => {
    const scelle = sceller("1//jeton-de-rafraichissement", secret);
    assert.ok(!scelle.includes("jeton"));
    assert.equal(ouvrir(scelle, secret), "1//jeton-de-rafraichissement");
    // Un nouvel aléa à chaque fois : deux sceaux du même jeton diffèrent.
    assert.notEqual(sceller("a", secret), sceller("a", secret));
  });

  it("refuse un autre secret et un contenu altéré", () => {
    const scelle = sceller("jeton", secret);
    assert.equal(ouvrir(scelle, `${secret}!`), null);
    const [v, charge] = scelle.split(":");
    const octets = Buffer.from(charge, "base64");
    octets[octets.length - 1] ^= 1;
    assert.equal(ouvrir(`${v}:${octets.toString("base64")}`, secret), null);
    assert.equal(ouvrir("n'importe quoi", secret), null);
  });
});

describe("le texte d'une note en Markdown", () => {
  it("garde la structure et la mise en forme, retire la couleur, calcule les tableaux", () => {
    const md = noteMarkdown("Cours", [
      { kind: "text", content: JSON.stringify({ style: "h1", markup: "La **cellule**" }) },
      { kind: "text", content: JSON.stringify({ style: "p", markup: "Une {c:red}membrane{/c} _fine_." }) },
      { kind: "text", content: JSON.stringify({ style: "bullet", markup: "noyau" }) },
      { kind: "drawing", content: "{}" },
      { kind: "table", content: JSON.stringify({ rows: [["Note", "Coef"], ["12", "2"], ["=SOMME(A2:A2)", "a|b"]] }) },
    ])!;
    assert.ok(md.startsWith("# Cours\n\n# La **cellule**"));
    assert.ok(md.includes("Une membrane _fine_."));
    assert.ok(!md.includes("{c:"));
    assert.ok(md.includes("- noyau"));
    assert.ok(md.includes("| Note | Coef |\n| --- | --- |\n| 12 | 2 |\n| 12 | a\\|b |"), md);
  });

  it("ne rend rien pour une note sans texte", () => {
    assert.equal(noteMarkdown("Croquis", [{ kind: "drawing", content: "{}" }]), null);
    assert.equal(noteMarkdown("Vide", [{ kind: "text", content: JSON.stringify({ style: "p", markup: "  " }) }]), null);
  });
});
