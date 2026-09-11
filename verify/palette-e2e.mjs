/*
 * Barre d'outils de la page manuscrite, et options de prise de notes.
 *
 * Le point de la refonte : deux rangées, « ce qu'on fait » puis « avec quoi »,
 * et la seconde ne montre que les réglages de l'outil courant.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (t) => console.log(`\n── ${t} ──`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 150)); ko++; });

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(600);

const presse = (nom) => page.getByRole("button", { name: nom, exact: true }).getAttribute("aria-pressed");

// --- Les réglages suivent l'outil --------------------------------------------
section("réglages contextuels");
await page.getByRole("button", { name: "Stylo", exact: true }).click();
check((await page.getByRole("group", { name: "Couleur" }).count()) === 1, "le stylo montre ses couleurs");
check((await page.getByRole("group", { name: "Forme" }).count()) === 0, "et pas les formes");

await page.getByRole("button", { name: "Formes", exact: true }).click();
await page.waitForTimeout(300);
check((await page.getByRole("group", { name: "Forme" }).count()) === 1, "les formes montrent les leurs");

await page.getByRole("button", { name: "Gomme", exact: true }).click();
await page.waitForTimeout(300);
check((await page.getByRole("group", { name: "Couleur" }).count()) === 0, "la gomme n'a pas de couleur");
check(
  (await page.getByRole("button", { name: /Surlignages seulement/ }).count()) === 1,
  "mais elle a son mode sélectif",
);

await page.getByRole("button", { name: "Lasso", exact: true }).click();
await page.waitForTimeout(300);
check(
  (await page.getByText("Entoure des traits").count()) === 1,
  "le lasso explique ce qu'il attend tant que rien n'est retenu",
);

// --- Chaque outil retient ses réglages ---------------------------------------
section("mémoire par outil");
await page.getByRole("button", { name: "Stylo", exact: true }).click();
await page.getByRole("button", { name: "Bleu", exact: true }).click();
await page.waitForTimeout(200);
check((await presse("Bleu")) === "true", "le stylo passe au bleu");

await page.getByRole("button", { name: "Surligneur", exact: true }).click();
await page.waitForTimeout(300);
check((await presse("Bleu")) !== "true", "le surligneur garde sa propre couleur");
await page.getByRole("button", { name: "Vert", exact: true }).click();
await page.waitForTimeout(200);

await page.getByRole("button", { name: "Stylo", exact: true }).click();
await page.waitForTimeout(300);
check(
  (await presse("Bleu")) === "true",
  "et le stylo retrouve la sienne en revenant",
  `bleu=${await presse("Bleu")}`,
);

// --- Verrou du stylet ---------------------------------------------------------
section("verrou du stylet");
const verrou = page.getByRole("button", { name: "Empêcher le doigt d'écrire" });
check((await verrou.count()) === 1, "le verrou est proposé");
await verrou.click();
await page.waitForTimeout(300);
check(
  (await page.getByRole("button", { name: /le doigt n'écrit pas/i }).count()) === 1,
  "et il s'annonce une fois posé",
);
check(
  (await page.getByText("Stylet", { exact: true }).count()) === 1,
  "avec une mention lisible, sans survol",
);

// Le doigt ne doit plus rien tracer.
const toile = page.locator('[data-testid="drawing-canvas"]').last();
const avant = await toile.getAttribute("aria-label");
await page.evaluate(() => {
  const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const el = tous[tous.length - 1];
  const r = el.getBoundingClientRect();
  const fire = (type, x, y, buttons) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch",
        isPrimary: true, pressure: 0.5, buttons,
        clientX: r.left + r.width * x, clientY: r.top + r.height * y,
      }),
    );
  fire("pointerdown", 0.2, 0.3, 1);
  fire("pointermove", 0.5, 0.4, 1);
  fire("pointermove", 0.7, 0.3, 1);
  fire("pointerup", 0.7, 0.3, 0);
});
await page.waitForTimeout(400);
check(
  (await toile.getAttribute("aria-label")) === avant,
  "le doigt ne trace rien, verrou posé",
  `${avant} → ${await toile.getAttribute("aria-label")}`,
);

// --- Gomme sélective -----------------------------------------------------------
section("gomme sélective");
await page.getByRole("button", { name: /le doigt n'écrit pas/i }).click();
await page.waitForTimeout(200);

async function tracer(points, outil) {
  await page.getByRole("button", { name: outil, exact: true }).click();
  await page.evaluate((points) => {
    const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
    const el = tous[tous.length - 1];
    const r = el.getBoundingClientRect();
    const fire = (type, x, y, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
          isPrimary: true, pressure: 0.7, buttons,
          clientX: r.left + r.width * x, clientY: r.top + r.height * y,
        }),
      );
    fire("pointerdown", points[0][0], points[0][1], 1);
    for (const [x, y] of points.slice(1)) fire("pointermove", x, y, 1);
    fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0);
  }, points);
  await page.waitForTimeout(400);
}

await tracer([[0.2, 0.25], [0.5, 0.26], [0.8, 0.25]], "Stylo");
await tracer([[0.2, 0.4], [0.5, 0.41], [0.8, 0.4]], "Surligneur");
check((await toile.getAttribute("aria-label")).includes("2 trait"), "un trait de chaque");

await page.getByRole("button", { name: "Gomme", exact: true }).click();
await page.getByRole("button", { name: /Surlignages seulement/ }).click();
await page.waitForTimeout(300);
// On passe la gomme sur les deux.
for (const y of [0.25, 0.4]) {
  await page.evaluate((y) => {
    const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
    const el = tous[tous.length - 1];
    const r = el.getBoundingClientRect();
    const fire = (type, x, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
          isPrimary: true, pressure: 0.7, buttons,
          clientX: r.left + r.width * x, clientY: r.top + r.height * y,
        }),
      );
    fire("pointerdown", 0.2, 1);
    for (const x of [0.35, 0.5, 0.65, 0.8]) fire("pointermove", x, 1);
    fire("pointerup", 0.8, 0);
  }, y);
  await page.waitForTimeout(400);
}
check(
  (await toile.getAttribute("aria-label")).includes("1 trait"),
  "seul le surlignage est effacé, l'écriture reste",
  await toile.getAttribute("aria-label"),
);

// --- Navigation entre pages ----------------------------------------------------
section("navigation entre pages");
check(
  (await page.getByRole("button", { name: /Choisir une page/ }).count()) === 0,
  "aucun repère de page tant qu'il n'y en a qu'une",
);
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForTimeout(1200);

const repere = page.getByRole("button", { name: /Choisir une page/ });
check((await repere.count()) === 1, "le repère apparaît dès la deuxième page");
check(
  (await repere.innerText()).includes("/ 3"),
  "et annonce le nombre de pages",
  await repere.innerText(),
);

await repere.click();
await page.waitForTimeout(400);
check((await page.getByRole("list", { name: "Pages manuscrites" }).count()) === 1, "la liste s'ouvre");
await page.getByRole("list", { name: "Pages manuscrites" }).getByRole("button", { name: "3" }).click();
await page.waitForTimeout(1200);
check(
  (await repere.innerText()).includes("3 / 3"),
  "et sauter à une page met le repère à jour",
  await repere.innerText(),
);

await page.screenshot({ path: "shots/palette.png" });
console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
