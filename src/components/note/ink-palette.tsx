"use client";

import * as React from "react";
import { AlignJustify, Camera, Circle, Crosshair, Eraser, FileMinus2, FilePlus2, Grid3x3, Grip, Highlighter, Lasso, Loader2, Maximize2, Minus as LineIcon, Pen, PenOff, RectangleVertical, Redo2, Ruler as RulerIcon, Scissors, Shapes, Square as RectIcon, Trash2, Undo2, X } from "lucide-react";

import { INSTRUMENTS, rulerDegrees, SHAPES, TOOLS, type Ruler, type Shape, type Tool } from "@/lib/ink";
import { INSTRUMENT_ORDER } from "@/lib/ink-stroke";
import { GommeDessinee, InstrumentBulle, InstrumentDessine } from "@/components/note/ink-instrument";
import { estVertical, InkDock, type PositionBarre } from "@/components/note/ink-dock";
import { inkCss, isCustomInk } from "@/lib/ink-color";
import { InkWheel } from "@/components/note/ink-wheel";
import { PAPERS, type Paper } from "@/lib/notes";
import { usePalmGuard } from "@/lib/palm";
import { cn } from "@/lib/utils";
import type { InkTool } from "@/components/note/ink-canvas";

/**
 * Barre d'outils de la page manuscrite.
 *
 * Elle tenait sur une seule rangée plate : outil, six couleurs, trois
 * épaisseurs, quatre papiers, règle, annulation, plein écran — une vingtaine de
 * commandes de même poids, qui formaient un mur sur téléphone.
 *
 * Deux rangées désormais, et une hiérarchie : **ce qu'on fait** en haut, **avec
 * quoi** en dessous. La seconde rangée ne montre que les réglages de l'outil
 * courant, et disparaît pour ceux qui n'en ont pas. C'est le fonctionnement des
 * applications de référence, et la raison en est simple : on change d'outil bien
 * plus souvent qu'on ne change ses réglages.
 */

export const INKS = [
  { name: "default", label: "Encre" },
  { name: "rose", label: "Rouge" },
  { name: "amber", label: "Orange" },
  { name: "emerald", label: "Vert" },
  { name: "blue", label: "Bleu" },
  { name: "violet", label: "Violet" },
] as const;

/*
 * Les trois épaisseurs viennent de l'instrument.
 *
 * Elles vivaient ici, en deux tableaux — un pour le stylo, un pour le
 * surligneur — et un troisième instrument en aurait demandé un troisième. Un
 * crayon ne s'épaissit pas comme un feutre : c'est une propriété de
 * l'instrument, et elle est rangée avec les autres dans `INSTRUMENTS`.
 */
const NOMS_TAILLE = ["Fin", "Moyen", "Épais"] as const;

/*
 * Les fonds ont leurs propres icônes.
 *
 * Ils empruntaient celles des formes — carré, trait, cercle — et une viseur
 * pour les carreaux : outil « Formes » actif, la même rangée montrait deux
 * carrés et deux cercles qui ne voulaient pas dire la même chose. Une feuille,
 * des lignes, un quadrillage, une trame de points : ce qu'on verra sur la page.
 */
const PAPER_LABELS: Record<Paper, { label: string; icon: React.ElementType }> = {
  blank: { label: "Uni", icon: RectangleVertical },
  ruled: { label: "Lignes", icon: AlignJustify },
  grid: { label: "Carreaux", icon: Grid3x3 },
  dots: { label: "Points", icon: Grip },
};

const SHAPE_ICONS: Record<Shape, { label: string; icon: React.ElementType }> = {
  line: { label: "Ligne", icon: LineIcon },
  rect: { label: "Rectangle", icon: RectIcon },
  ellipse: { label: "Ellipse", icon: Circle },
};

/** Réglages propres à un outil d'écriture. */
export type InkSettings = { color: string; size: number };

export type PaletteProps = {
  tool: InkTool;
  /**
   * Les réglages, **un jeu par instrument**.
   *
   * Un crayon vert fin et un feutre rouge épais coexistent : changer d'outil
   * ne doit pas emporter les réglages du précédent. C'était déjà vrai du stylo
   * et du surligneur ; ça l'est maintenant des cinq.
   */
  settings: Record<Tool, InkSettings>;
  shape: Shape;
  /** Où la barre est posée, et si elle est repliée en bulle. */
  position: PositionBarre;
  onPosition: (next: PositionBarre) => void;
  paper: Paper;
  /** La gomme ne retire-t-elle que les surlignages ? */
  eraseHighlightsOnly: boolean;
  erasePrecise: boolean;
  /** Le doigt n'écrit jamais, même avant qu'un stylet ait servi. */
  penOnly: boolean;
  penDetected: boolean;
  selection: number;
  zoom: number;
  full: boolean;
  /**
   * Le fond de la page courante peut-il être choisi ?
   *
   * Non sur une page du document importé : son image **est** son fond, et
   * poser du quadrillage par-dessus un polycopié n'a pas de sens.
   */
  paperEditable: boolean;
  /** Peut-on glisser une feuille après la page courante ? */
  canAddPage: boolean;
  /** La page courante est-elle une page ajoutée, donc retirable ? */
  canRemovePage: boolean;
  /** Y a-t-il une action à annuler, ou à refaire ? */
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Photographier ou importer une image, qui devient une page après la page
   * courante. Absent en lecture seule.
   */
  onAddImage?: () => void;
  /** L'image part au serveur : le bouton tourne, et ne se relance pas. */
  addingImage?: boolean;
  onTool: (tool: InkTool) => void;
  onSettings: (next: InkSettings) => void;
  onShape: (shape: Shape) => void;
  /** Change le fond de la page courante — ou de la surface s'il n'y en a qu'une. */
  onPaper: (paper: Paper) => void;
  /** Glisse une feuille juste après la page courante. */
  onAddPage: () => void;
  /** Retire la page courante, et ce qui était écrit dessus. */
  onRemovePage: () => void;
  onEraseHighlightsOnly: (value: boolean) => void;
  onErasePrecise: (value: boolean) => void;
  onPenOnly: (value: boolean) => void;
  onDeleteSelection: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onResetView: () => void;
  onToggleFull: () => void;
  ruler: Ruler | null;
  onToggleRuler: () => void;
};

export function InkPalette(props: PaletteProps) {
  const {
    tool,
    settings,
    shape,
    position,
    paper,
    eraseHighlightsOnly,
    erasePrecise,
    penOnly,
    penDetected,
    selection,
    zoom,
    full,
    paperEditable,
    canAddPage,
    canRemovePage,
    canUndo,
    canRedo,
    ruler,
  } = props;

  /**
   * L'instrument dont on règle la couleur et l'épaisseur.
   *
   * Les formes se tracent au stylo : elles n'ont pas d'instrument à elles, et
   * leur en inventer un ferait un sixième jeu de réglages pour rien.
   */
  const instrument: Tool = (TOOLS as readonly string[]).includes(tool)
    ? (tool as Tool)
    : "pen";
  const ecrit = tool !== "eraser" && tool !== "lasso";
  const reglages = settings[instrument];
  const tailles = INSTRUMENTS[instrument].tailles;
  const vertical = props.full && estVertical(position.bord) && !position.reduit;

  /*
   * La barre est posée là où la main se pose.
   *
   * En plein écran elle flotte en bas, à portée du pouce — et donc sous le
   * tranchant de la main quand on écrit. Sans ce rejet, la paume y déclenchait
   * la sélection de texte d'iPadOS, et parfois un bouton.
   */
  const garde = usePalmGuard<HTMLDivElement>();
  // La roue chromatique n'est montée qu'ouverte : elle repart ainsi de la
  // couleur courante à chaque fois.
  const [roue, setRoue] = React.useState(false);
  const libre = isCustomInk(reglages.color);

  /*
   * En plein écran, la barre **flotte** et se déplace ; en ligne, elle reste
   * posée au-dessus de la page.
   *
   * La différence n'est pas un caprice : en ligne, la page manuscrite est une
   * fenêtre au milieu d'une note, et une barre qui flotterait par-dessus
   * couvrirait ce qu'on écrit sans rien gagner. En plein écran, la feuille
   * occupe l'écran : c'est là que la place de la barre devient un problème, et
   * là qu'on veut pouvoir la pousser de côté ou la replier.
   */
  return (
    <InkDock
      flottante={full}
      position={position}
      onPosition={props.onPosition}
      toolbarRef={garde}
      // Repliée, la barre ne montre plus que l'instrument en cours : c'est la
      // seule chose qu'on a besoin de savoir pour décider de la rouvrir.
      bulle={<InstrumentBulle tool={tool === "eraser" ? "eraser" : instrument} color={reglages.color} />}
    >
      {/* --- Ce qu'on fait ---------------------------------------------- */}
      <div className={cn("flex flex-wrap items-center gap-0.5", vertical && "justify-center")}>
        {/*
          * La fente des instruments.
          *
          * Ils sont dessinés, pointe en bas, et l'instrument en cours **monte**
          * de quelques pixels. C'est la convention d'Apple, et elle dit sans
          * légende deux choses à la fois : lequel est choisi, et avec quelle
          * encre il écrit — la pointe porte la couleur.
          */}
        <div
          role="group"
          aria-label="Instrument"
          data-testid="instruments"
          /*
           * La fente passe à la ligne, et ne se rétrécit **jamais**.
           *
           * Ce sont deux choses différentes, et il faut les deux. Sans le
           * passage à la ligne, les six instruments tenaient sur une rangée de
           * deux cent soixante pixels dans une colonne qui en fait cent : le
           * stylo se retrouvait à vingt-deux pixels **à gauche** du bord de la
           * barre, hors d'elle, invisible et intouchable. Et `shrink-0` sur la
           * fente elle-même produisait exactement cela — c'est sur les
           * **boutons** qu'il doit être, pour qu'ils gardent leurs 44 px.
           *
           * `overflow-hidden` fait la fente : les instruments sont décalés vers
           * le bas et le bord les coupe, ce qui les fait paraître enfoncés.
           */
          className="flex flex-wrap items-end justify-center gap-0.5 overflow-hidden rounded-2xl bg-surface-container-high px-1 pt-1.5"

        >
          {INSTRUMENT_ORDER.map((name) => (
            <BoutonInstrument
              key={name}
              active={tool === name}
              onClick={() => props.onTool(name)}
              label={INSTRUMENTS[name].label}
              color={settings[name].color}
              tool={name}
            />
          ))}
          <BoutonInstrument
            active={tool === "eraser"}
            onClick={() => props.onTool("eraser")}
            label="Gomme"
          />
        </div>

        <Group label="Sélection et tracés">
          <Tool active={tool === "lasso"} onClick={() => props.onTool("lasso")} icon={Lasso} label="Lasso" />
          <Tool active={tool === "shape"} onClick={() => props.onTool("shape")} icon={Shapes} label="Formes" />
          <Tool
            active={Boolean(ruler)}
            onClick={props.onToggleRuler}
            icon={RulerIcon}
            label={ruler ? "Ranger la règle" : "Poser la règle"}
          />
        </Group>

        {/* Photographier ou importer : dans la rangée des outils, toujours
            visible, parce qu'on y pense au milieu d'une page — pas en allant
            chercher le bas de la note. Sur iPad, le même bouton propose
            « Prendre une photo », la photothèque et les fichiers. */}
        {props.onAddImage ? (
          <Tool
            onClick={props.onAddImage}
            icon={props.addingImage ? Loader2 : Camera}
            busy={props.addingImage}
            disabled={props.addingImage}
            label="Ajouter une photo, une image ou un document"
            title="Photographier, importer une image, un PDF ou un document Word : il devient une ou plusieurs pages, juste après celle-ci"
          />
        ) : null}

        {/* L'angle de la règle : c'est le propre d'une règle qu'on puisse
            l'aligner sur une valeur franche. */}
        {ruler ? (
          <span
            className="ml-1 rounded-full bg-surface-container px-2 py-1 m3-label-small tabular-nums text-on-surface-variant"
            title="Glisse la règle du doigt pour la déplacer, saisis-la par un bout pour l'orienter. Le stylet, lui, écrit le long du bord."
          >
            {rulerDegrees(ruler)}°
          </span>
        ) : null}

        <div className={cn("flex flex-wrap items-center justify-center gap-0.5", vertical ? "w-full" : "ml-auto")}>
          {Math.abs(zoom - 1) > 0.01 ? (
            <button
              type="button"
              onClick={props.onResetView}
              title="Revenir à la taille d'origine"
              aria-label={`Zoom ${Math.round(zoom * 100)} %. Revenir à la taille d'origine`}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-container px-3 m3-label-small tabular-nums text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <Crosshair className="size-3.5" />
              {Math.round(zoom * 100)} %
            </button>
          ) : null}

          {/* Le rejet de la paume est invisible : le doigt cesse d'écrire sans
              rien dire. L'état est donc **écrit**, pas seulement suggéré par une
              icône teintée — sur une tablette il n'y a pas de survol pour lire
              une infobulle. */}
          {penOnly || penDetected ? (
            <button
              type="button"
              onClick={() => props.onPenOnly(!penOnly)}
              aria-pressed={penOnly}
              aria-label={
                penOnly ? "Le doigt n'écrit pas — rétablir" : "Stylet détecté : le doigt fait défiler"
              }
              title={
                penOnly
                  ? "Le doigt n'écrit pas. Toucher pour le rétablir."
                  : "Un stylet a été détecté : le doigt fait défiler, pour que la paume ne marque pas la page."
              }
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-primary-container px-3 m3-label-small text-on-primary-container"
            >
              <Pen className="size-3.5" />
              Stylet
            </button>
          ) : (
            <Tool
              onClick={() => props.onPenOnly(true)}
              icon={PenOff}
              label="Empêcher le doigt d'écrire"
            />
          )}
          {/* Annuler rend ce que la dernière action a changé — un trait, un coup
              de gomme, une sélection déplacée, la page effacée. Grisés quand il
              n'y a rien à faire : un bouton qui ne répond pas passe pour une
              panne. Deux doigts tapés sur la page annulent aussi. */}
          <Tool
            onClick={props.onUndo}
            icon={Undo2}
            label="Annuler"
            title="Annuler — ou toucher la page de deux doigts"
            disabled={!canUndo}
          />
          <Tool
            onClick={props.onRedo}
            icon={Redo2}
            label="Rétablir"
            title="Rétablir — ou toucher la page de trois doigts"
            disabled={!canRedo}
          />
          <Tool
            onClick={props.onClear}
            icon={Trash2}
            label="Effacer toute la page"
            title="Effacer toute la page — Annuler la rend"
            danger
          />
          <Tool
            onClick={props.onToggleFull}
            icon={full ? X : Maximize2}
            label={full ? "Quitter le plein écran" : "Écrire en plein écran"}
            active={full}
          />
        </div>
      </div>

      {/* --- Avec quoi ---------------------------------------------------- */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-0.5 border-t border-outline-variant/60 pt-1",
          vertical && "justify-center",
        )}
      >
        {ecrit ? (
          <>
            <Group label="Couleur">
              {INKS.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => props.onSettings({ ...reglages, color: entry.name })}
                  aria-label={entry.label}
                  aria-pressed={reglages.color === entry.name}
                  title={entry.label}
                  className="grid size-11 place-items-center rounded-full"
                >
                  <span
                    className={cn(
                      "block rounded-full transition-all",
                      reglages.color === entry.name
                        ? "size-6 ring-2 ring-primary ring-offset-2 ring-offset-surface"
                        : "size-5",
                    )}
                    style={{ backgroundColor: `var(--ink-${entry.name})` }}
                  />
                </button>
              ))}

              {/* Au-delà des six encres, la roue. Le bouton porte la couleur libre
                  en cours quand il y en a une : on voit avec quoi on écrit, et le
                  même geste permet d'en changer. Un seul bouton plutôt qu'une
                  pastille de plus : sept tiennent sur une rangée de téléphone,
                  huit la faisaient déborder. */}
              <button
                type="button"
                onClick={() => setRoue(true)}
                aria-label="Autre couleur"
                aria-haspopup="dialog"
                aria-pressed={libre}
                title={libre ? `Couleur ${reglages.color} — en choisir une autre` : "Autre couleur"}
                className="grid size-11 place-items-center rounded-full"
              >
                <span
                  className={cn(
                    "grid place-items-center rounded-full transition-all",
                    libre ? "size-6 ring-2 ring-primary ring-offset-2 ring-offset-surface" : "size-5",
                  )}
                  style={{
                    background:
                      "conic-gradient(hsl(0 90% 55%), hsl(60 90% 50%), hsl(120 80% 42%), hsl(180 85% 45%), hsl(240 85% 60%), hsl(300 85% 55%), hsl(360 90% 55%))",
                  }}
                >
                  {libre ? (
                    <span
                      className="block size-3.5 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: reglages.color }}
                    />
                  ) : null}
                </span>
              </button>
              {roue ? (
                <InkWheel
                  value={reglages.color}
                  highlighter={INSTRUMENTS[instrument].dessous}
                  onClose={() => setRoue(false)}
                  onPick={(hex) => {
                    props.onSettings({ ...reglages, color: hex });
                    setRoue(false);
                  }}
                />
              ) : null}
            </Group>

            <Group label="Épaisseur">
              {tailles.map((taille, rang) => (
                <button
                  key={taille}
                  type="button"
                  onClick={() => props.onSettings({ ...reglages, size: taille })}
                  aria-label={NOMS_TAILLE[rang]}
                  aria-pressed={reglages.size === taille}
                  title={NOMS_TAILLE[rang]}
                  // Un anneau, pas un fond : posé sur le violet de sélection, le
                  // surligneur translucide virait au mauve et l'on ne voyait
                  // plus la couleur qu'on allait obtenir.
                  className={cn(
                    "grid size-11 place-items-center rounded-full transition-colors",
                    reglages.size === taille && "ring-2 ring-inset ring-primary",
                  )}
                >
                  {/*
                   * Un bout de trait, dans l'encre choisie, plutôt qu'un point
                   * gris : l'épaisseur « Fin » tenait en un point de 3,6 px qu'on
                   * ne voyait pas, et la couleur courante n'était rappelée que par
                   * une pastille en double de la rangée d'à côté. Le surligneur
                   * garde sa transparence, comme sur la page.
                   */}
                  {/* L'épaisseur montrée est celle qu'on obtiendra : la même
                      taille écrit trois fois plus large au surligneur qu'au
                      stylo, et l'échantillon doit le dire. */}
                  <span
                    className="block w-6 rounded-full"
                    style={{
                      height: Math.min(
                        14,
                        Math.max(2, taille * INSTRUMENTS[instrument].facteur * 1.5),
                      ),
                      backgroundColor: inkCss(reglages.color),
                      opacity: Math.max(0.42, INSTRUMENTS[instrument].alpha),
                    }}
                  />
                </button>
              ))}
            </Group>
          </>
        ) : null}

        {tool === "shape" ? (
          <Group label="Forme">
            {SHAPES.map((name) => (
              <Tool
                key={name}
                active={shape === name}
                onClick={() => props.onShape(name)}
                icon={SHAPE_ICONS[name].icon}
                label={SHAPE_ICONS[name].label}
              />
            ))}
          </Group>
        ) : null}

        {tool === "eraser" ? (
          <Group label="Gomme" className="flex-wrap">
            {/* Rayer un mot d'un geste, ou reprendre le détail d'une lettre :
                deux besoins opposés, deux gommes. Les libellés restent sur une
                ligne et c'est la rangée qui passe à la ligne : sur téléphone
                « Trait entier » se cassait en deux mots empilés. */}
            <button
              type="button"
              onClick={() => props.onErasePrecise(false)}
              aria-pressed={!erasePrecise}
              className={cn(
                "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 m3-label-large transition-colors",
                erasePrecise
                  ? "text-on-surface-variant hover:text-on-surface"
                  : "bg-primary-container text-on-primary-container",
              )}
              title="Effacer le trait entier d'un seul passage"
            >
              <Eraser className="size-4" />
              Trait entier
            </button>
            <button
              type="button"
              onClick={() => props.onErasePrecise(true)}
              aria-pressed={erasePrecise}
              className={cn(
                "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 m3-label-large transition-colors",
                erasePrecise
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
              title="Couper le trait sous la pointe, sans emporter le reste"
            >
              <Scissors className="size-4" />
              Précise
            </button>
            <button
              type="button"
              onClick={() => props.onEraseHighlightsOnly(!eraseHighlightsOnly)}
              aria-pressed={eraseHighlightsOnly}
              className={cn(
                "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 m3-label-large transition-colors",
                eraseHighlightsOnly
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
              title="N'effacer que les surlignages, en laissant l'écriture"
            >
              <Highlighter className="size-4" />
              Surlignages seulement
            </button>
          </Group>
        ) : null}

        {tool === "lasso" ? (
          selection > 0 ? (
            <Group label="Sélection">
              <span className="px-2 m3-label-small tabular-nums text-on-surface-variant">
                {selection} trait{selection > 1 ? "s" : ""}
              </span>
              <Tool
                onClick={props.onDeleteSelection}
                icon={Trash2}
                label="Supprimer la sélection"
                danger
              />
            </Group>
          ) : (
            <p className="px-2 m3-body-small text-on-surface-variant">
              Entoure des traits pour les déplacer ou les supprimer.
            </p>
          )
        ) : null}

        {/* --- La page elle-même ---------------------------------------- */}

        {/* Le fond de la page courante. Sur une page du document importé il n'y
            a rien à choisir : son image est son fond. */}
        {paperEditable ? (
          <Group label="Fond de page" className={vertical ? "w-full" : "ml-auto"}>
            {PAPERS.map((name) => {
              const entry = PAPER_LABELS[name];
              return (
                <Tool
                  key={name}
                  active={paper === name}
                  onClick={() => props.onPaper(name)}
                  icon={entry.icon}
                  label={entry.label}
                />
              );
            })}
          </Group>
        ) : null}

        {/* Glisser une feuille dans le document, comme on en glisse une dans un
            polycopié quand le cours déborde. La nouvelle page reprend le fond de
            sa voisine — c'est presque toujours ce qu'on veut, et les quatre
            boutons juste à gauche servent à en changer. */}
        {canAddPage ? (
          <Group label="Page" className={cn(!paperEditable && !vertical && "ml-auto")}>
            <Tool
              onClick={props.onAddPage}
              icon={FilePlus2}
              label="Ajouter une page après celle-ci"
            />
            {canRemovePage ? (
              <Tool
                onClick={props.onRemovePage}
                icon={FileMinus2}
                label="Supprimer cette page ajoutée"
                danger
              />
            ) : null}
          </Group>
        ) : null}
      </div>
    </InkDock>
  );
}

/**
 * Un instrument dans sa fente.
 *
 * Trois choses à la fois, et c'est tout l'intérêt : il dit **quel** outil
 * c'est par sa silhouette, **avec quelle encre** par sa pointe teintée, et
 * qu'il est choisi en **montant** de quelques pixels. Un aplat de couleur
 * derrière une icône n'en dirait qu'une.
 *
 * La cible tactile fait 44 px de haut malgré la fente : le bouton l'occupe
 * entièrement, c'est le dessin qui dépasse par le bas.
 */
function BoutonInstrument({
  active,
  onClick,
  label,
  tool,
  color,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  /** Absent pour la gomme, qui ne pose pas d'encre. */
  tool?: Tool;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-instrument={tool ?? "eraser"}
      className={cn(
        // 44 px de large, pas 32 : le dessin en fait 32, mais c'est la **zone
        // qui active** qui doit atteindre la cible tactile, et un instrument
        // qu'on rate une fois sur trois n'est pas un instrument. Mesuré à
        // 41 px sur un téléphone avant que la fente ne sache passer à la ligne.
        "grid h-11 w-11 shrink-0 place-items-end justify-items-center rounded-t-lg transition-transform duration-150",
        // L'outil en cours sort de la fente ; les autres y restent enfoncés,
        // mais **pointe visible** : c'est elle qui porte l'encre, et la couper
        // reviendrait à cacher la seule chose qu'on cherche du regard.
        active
          ? "-translate-y-2 drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]"
          : "translate-y-1 opacity-70 hover:-translate-y-0.5 hover:opacity-100",
      )}
    >
      {tool && color ? (
        <InstrumentDessine tool={tool} color={color} />
      ) : (
        <GommeDessinee />
      )}
    </button>
  );
}

/**
 * Un groupe de commandes.
 *
 * `flex-wrap` n'est pas décoratif : collée à un bord vertical, la barre ne fait
 * que deux boutons de large, et un groupe qui ne passe pas à la ligne y déborde
 * **sans rien signaler** — la première pastille de couleur et le bouton de
 * sortie du plein écran sortaient de la barre par la gauche, coupés en deux.
 */
function Group({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center justify-center gap-0.5", className)}
    >
      {children}
    </div>
  );
}

function Tool({
  active,
  onClick,
  icon: Icon,
  label,
  title,
  danger,
  disabled,
  busy,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  /** Infobulle, quand elle en dit plus que le nom du bouton. */
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Une action en cours : l'icône tourne. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      className={cn(
        "grid size-11 place-items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-primary-container text-on-primary-container"
          : cn("text-on-surface-variant", danger ? "hover:text-error" : "hover:text-on-surface"),
      )}
    >
      <Icon className={cn("size-5", busy && "animate-spin")} />
    </button>
  );
}
