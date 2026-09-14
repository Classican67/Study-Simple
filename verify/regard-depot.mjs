/* Le voile de dépôt, en clair et en sombre : il annonce ce qui va se passer. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });
const pdf = readFileSync("doc-test.pdf").toString("base64");

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1194, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.evaluate((base64) => {
    const dt = new DataTransfer();
    const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    dt.items.add(new File([octets], "Cours de biologie.pdf", { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover"]) {
      window.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, pdf);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/depot-${theme}.png` });
  console.log(`${theme} : capturé`);
  await ctx.close();
}
await browser.close();
