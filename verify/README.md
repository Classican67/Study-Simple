# Vérification visuelle

Ces scripts pilotent un vrai navigateur. Ils vivaient dans un dossier temporaire
que le système efface sans prévenir ; ils sont ici pour survivre d'une session à
l'autre.

Playwright est installé **dans ce dossier uniquement** : l'application n'a pas à
le porter dans ses dépendances.

## Mise en route

```bash
cd verify
./bootstrap.sh          # installe Playwright si besoin, régénère ctx.json
```

`bootstrap.sh` lit `.env` et `data/dev.db` du projet pour fabriquer un cookie de
session valide. Un jeton périmé fait rediriger vers `/login` : les scripts
mesurent alors l'écran de connexion en annonçant que tout va bien. Devant un
résultat étonnamment propre, relancer `./bootstrap.sh`.

## Les contrôles

Le serveur doit tourner sur le port 3100, **sur une copie de la base et un
dossier d'images à part** — sans quoi les essais écrivent dans les données
réelles :

```bash
cp data/dev.db verify/verif.db
DATABASE_URL="file:$PWD/verify/verif.db" UPLOAD_DIR="$PWD/verify/uploads" \
  npx next start -p 3100
```

| Script | Ce qu'il vérifie |
| --- | --- |
| `node shoot.mjs` | Captures, débordement **horizontal**, erreurs console |
| `node audit.mjs` | Contraste WCAG 4.5:1, cibles tactiles 44 px, cohérence des positions |
| `node hauteur.mjs` | La révision tient dans l'écran, sur cinq tailles d'appareil |
| `node notes-e2e.mjs` | Notes : texte, tableau calculé, croquis au stylet, persistance |
| `node copies-e2e.mjs` | Regroupement : indépendance des copies dans les deux sens, et sûreté des images partagées |

Chacun sort en code non nul s'il trouve quelque chose.
