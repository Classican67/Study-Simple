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

**Après chaque `npm run build`, relancer le serveur du port 3100** : `next start`
sert le build qu'il a trouvé au démarrage, et reconstruire sous lui ne change
rien à ce qu'il répond.

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
| `node notes-avancees-e2e.mjs` | Notes : dossiers, recherche par mots-clés et filtres, page manuscrite plein écran |
| `node dossiers-e2e.mjs` | Dossiers séparés entre paquets et notes, et portée de la recherche |
| `node pages-e2e.mjs` | Pages d'une note : gomme précise, duplication, volet de pages |
| `node regard.mjs` | Captures ciblées du document empilé et du volet, en clair et en sombre |
| `node vignettes-e2e.mjs` | Liste des notes : vignettes, tailles d'affichage, tri, et poids de la liste |
| `node ecriture-e2e.mjs` | Manuscrit : épaisseur du trait, continuité de la couche vive, reprise après `pointercancel`, contournement de Scribble, netteté au zoom, coût sur page dense, main posée sur la barre, appui maintenu, encre qui ne se redessine pas en défilant |
| `node regard-ecriture.mjs` | Captures de l'écriture à 1× et agrandie, en clair et en sombre |
| `node fonds-e2e.mjs` | Pages ajoutées dans un document, quatre fonds, interligne au zoom, réglage à l'export |
| `node regard-fonds.mjs` | Captures des quatre fonds, en clair et en sombre |
| `node regard-export.mjs` | Le PDF exporté, relu par l'application et photographié |
| `node photo-e2e.mjs` | Photo annotable : page au format de l'image, écriture, persistance, vignette, PDF, encre lisible en sombre |
| `node regard-photo.mjs` | Captures d'une photo annotée, en clair et en sombre |
| `node historique-e2e.mjs` | Annuler après la gomme ou la page effacée, boutons grisés, touchers à deux et trois doigts, anneau de la gomme |
| `node page-photo-e2e.mjs` | Photo ajoutée depuis la barre : page simple, milieu de pile, document ; annotations, Annuler et fichier, plein écran, téléphone ; note neuve manuscrite |
| `node couleur-e2e.mjs` | Roue chromatique : clavier, geste, code exact, couleur peinte, rechargement, PDF, thème sombre, téléphone |
| `node regard-palette.mjs` | Captures de la barre d'outils : téléphone et desktop, clair et sombre, stylo, surligneur, gomme |
| `node telephone-e2e.mjs` | Documents et photos sur téléphone : densité du PDF, hauteur de la surface, palette non recouverte en plein écran |
| `node import-e2e.mjs` | Import système : dépôt d'un fichier, dossier de destination, titre, refus, réponse au partage |
| `node regard-depot.mjs` | Capture du voile de dépôt, en clair et en sombre |
| `node palette-e2e.mjs` | Barre d'outils : réglages contextuels, mémoire par outil, verrou stylet, gomme sélective, navigation entre pages |
| `node export-pdf-e2e.mjs` | Export PDF : aplati et annotations Ink conformes, document d'origine intact, PDF relisible |
| `node document-e2e.mjs` | Import d'un PDF : une page annotable par page, annotation conservée, refus des formats inconnus |
| `node glisser-e2e.mjs` | Glisser une note ou un paquet dans un dossier, au doigt |
| `node copies-e2e.mjs` | Regroupement : indépendance des copies dans les deux sens, et sûreté des images partagées |
| `node selection-e2e.mjs` | Choix des paquets : rien de coché d'avance, comptes par paquet, total qui suit |

Chacun sort en code non nul s'il trouve quelque chose.
