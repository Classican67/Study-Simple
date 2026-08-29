import { describe, it } from "node:test";
import assert from "node:assert/strict";

import nextConfig from "../next.config";

/**
 * Les en-têtes de sécurité sont faciles à resserrer par réflexe, et une
 * politique trop stricte casse une fonction sans le moindre message d'erreur.
 * C'est exactement ce qui est arrivé à l'appareil photo : `camera=()`
 * l'interdisait à l'app elle-même.
 */
async function headerMap(source: string): Promise<Map<string, string>> {
  const groups = await nextConfig.headers!();
  const group = groups.find((g) => g.source === source);
  assert.ok(group, `aucun groupe d'en-têtes pour ${source}`);
  return new Map(group.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("Permissions-Policy", () => {
  it("autorise l'appareil photo à sa propre origine", async () => {
    const policy = (await headerMap("/(.*)")).get("permissions-policy") ?? "";
    assert.match(policy, /camera=\(self\)/, `politique : ${policy}`);
    // `camera=()` interdirait l'appareil photo à l'app elle-même : la prise
    // de photo d'une fiche cesserait de fonctionner, en silence.
    assert.doesNotMatch(policy, /camera=\(\)/);
  });

  it("refuse toujours ce qui n'est pas utilisé", async () => {
    const policy = (await headerMap("/(.*)")).get("permissions-policy") ?? "";
    assert.match(policy, /microphone=\(\)/);
    assert.match(policy, /geolocation=\(\)/);
  });
});

describe("en-têtes de sécurité", () => {
  it("conserve les protections de base", async () => {
    const headers = await headerMap("/(.*)");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("interdit la mise en cache du service worker", async () => {
    // Sans cela un navigateur peut servir des semaines durant l'ancienne
    // version de l'app après un déploiement.
    const headers = await headerMap("/sw.js");
    assert.match(headers.get("cache-control") ?? "", /no-store|no-cache/);
  });
});
