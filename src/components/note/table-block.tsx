"use client";

import * as React from "react";
import { Columns3, Rows3, Trash2 } from "lucide-react";

import { columnName, evaluateSheet, isFormula } from "@/lib/sheet";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS, type TableContent } from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Mini tableur.
 *
 * Une cellule montre **son résultat** quand elle n'a pas le focus, et **sa
 * formule** quand on l'édite : c'est le comportement de tout tableur, et sans
 * lui on ne peut ni relire ses calculs ni les corriger.
 *
 * La première ligne sert d'en-tête. Elle n'est pas calculée — un intitulé
 * commençant par `=` serait une surprise désagréable — mais elle compte dans
 * les références : l'en-tête est la ligne 1, la première donnée la ligne 2,
 * comme dans Excel.
 */
export function TableBlock({
  content,
  onChange,
  readOnly = false,
}: {
  content: TableContent;
  onChange: (next: TableContent) => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = React.useState<{ row: number; col: number } | null>(null);
  const rows = content.rows;
  const width = rows[0]?.length ?? 0;

  // Les valeurs affichées, recalculées à chaque changement. L'en-tête est
  // remplacé par du vide pour le calcul : il ne doit pas être interprété.
  const values = React.useMemo(
    () => evaluateSheet(rows.map((row, index) => (index === 0 ? row.map(neutralise) : row))),
    [rows],
  );

  function setCell(row: number, col: number, value: string) {
    const next = rows.map((r, ri) => r.map((c, ci) => (ri === row && ci === col ? value : c)));
    onChange({ rows: next });
  }

  function addRow() {
    if (rows.length >= MAX_TABLE_ROWS) return;
    onChange({ rows: [...rows, Array(width).fill("")] });
  }

  function addColumn() {
    if (width >= MAX_TABLE_COLS) return;
    onChange({ rows: rows.map((row) => [...row, ""]) });
  }

  function removeRow(index: number) {
    // On ne descend pas sous une ligne : un tableau sans aucune ligne ne se
    // remplirait plus, faute de cellule où cliquer.
    if (rows.length <= 1) return;
    onChange({ rows: rows.filter((_, i) => i !== index) });
  }

  function removeColumn(index: number) {
    if (width <= 1) return;
    onChange({ rows: rows.map((row) => row.filter((_, i) => i !== index)) });
  }

  return (
    <div className="space-y-2">
      {/* Le tableau défile horizontalement dans son propre cadre : sur un
          téléphone, huit colonnes ne tiennent pas, et la page entière ne doit
          pas se mettre à défiler pour autant. */}
      <div className="scroll-slim overflow-x-auto rounded-xl border border-outline-variant">
        <table className="w-full border-collapse m3-body-medium">
          <thead>
            <tr>
              <th scope="col" className="w-11 bg-surface-container" />
              {Array.from({ length: width }, (_, col) => (
                <th
                  key={col}
                  scope="col"
                  className="h-11 border-l border-outline-variant bg-surface-container px-1 m3-label-small font-normal text-on-surface-variant"
                >
                  <span className="flex items-center justify-between gap-1">
                    {columnName(col)}
                    {!readOnly && width > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeColumn(col)}
                        aria-label={`Supprimer la colonne ${columnName(col)}`}
                        // Toujours présent, simplement estompé : masquer au
                        // survol rendait la suppression impossible sur une
                        // tablette, où il n'y a pas de survol. La cible fait
                        // 44 px, l'icône reste petite.
                        className="grid size-11 shrink-0 place-items-center rounded-full opacity-45 transition-opacity hover:text-error hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="group">
                <th
                  scope="row"
                  className="w-11 border-t border-outline-variant bg-surface-container text-center m3-label-small font-normal text-on-surface-variant"
                >
                  <span className="flex flex-col items-center justify-center">
                    {ri + 1}
                    {!readOnly && rows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRow(ri)}
                        aria-label={`Supprimer la ligne ${ri + 1}`}
                        className="grid size-11 shrink-0 place-items-center rounded-full opacity-45 transition-opacity hover:text-error hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </span>
                </th>
                {row.map((raw, ci) => {
                  const open = editing?.row === ri && editing?.col === ci;
                  const value = values[ri]?.[ci];
                  return (
                    <td
                      key={ci}
                      className={cn(
                        "border-l border-t border-outline-variant p-0",
                        ri === 0 && "bg-surface-container/60",
                      )}
                    >
                      <input
                        value={open ? raw : (value?.text ?? "")}
                        readOnly={readOnly}
                        onFocus={() => setEditing({ row: ri, col: ci })}
                        onBlur={() => setEditing(null)}
                        onChange={(event) => setCell(ri, ci, event.target.value)}
                        aria-label={`${columnName(ci)}${ri + 1}`}
                        className={cn(
                          "h-11 w-full min-w-24 bg-transparent px-2 text-on-surface outline-none",
                          "focus:bg-primary-container/30 focus:ring-2 focus:ring-inset focus:ring-primary",
                          ri === 0 && "font-medium",
                          // Les nombres se lisent alignés à droite ; les
                          // erreurs se signalent par la couleur.
                          !open && value?.numeric !== null && "text-right tabular-nums",
                          value?.error && "text-error",
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= MAX_TABLE_ROWS}
            className="state-layer flex min-h-11 items-center gap-2 rounded-full bg-surface-container px-4 m3-label-large text-on-surface-variant disabled:opacity-50"
          >
            <Rows3 className="size-4" />
            Ligne
          </button>
          <button
            type="button"
            onClick={addColumn}
            disabled={width >= MAX_TABLE_COLS}
            className="state-layer flex min-h-11 items-center gap-2 rounded-full bg-surface-container px-4 m3-label-large text-on-surface-variant disabled:opacity-50"
          >
            <Columns3 className="size-4" />
            Colonne
          </button>
          <p className="m3-body-small text-on-surface-variant">
            Formules : <code className="rounded bg-surface-container px-1">=SOMME(A2:A9)</code>,
            moyenne, min, max, nb. Arguments séparés par <code>;</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Neutralise un intitulé d'en-tête pour le calcul.
 * Un titre de colonne écrit « =Total » est du texte, pas une formule.
 */
function neutralise(value: string): string {
  return isFormula(value) ? "" : value;
}
