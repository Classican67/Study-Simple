/**
 * Copie le worker de pdf.js dans public/.
 *
 * pdf.js analyse et rend un document dans un worker ; sans lui, tout se fait
 * sur le fil principal et l'interface gèle le temps du rendu.
 *
 * Le faire résoudre par le bundler ne marche pas : `new URL("pdfjs-dist/…",
 * import.meta.url)` est interprété comme un chemin **relatif au module**, pas
 * comme une référence de paquet, et aboutit à un 404 silencieux. Le servir
 * depuis public/ est direct et ne dépend d'aucune magie de bundler.
 *
 * Le fichier n'est pas versionné : il est recopié avant chaque `dev` et
 * `build`, et suit donc toujours la version installée.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "build/pdf.worker.min.mjs");
const cible = path.join(process.cwd(), "public", "pdf.worker.min.mjs");

await mkdir(path.dirname(cible), { recursive: true });
await copyFile(source, cible);
console.log("worker pdf.js copié dans public/");
