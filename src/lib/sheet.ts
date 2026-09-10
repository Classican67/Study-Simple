/**
 * Mini tableur — évaluation de formules, sans base ni DOM.
 *
 * Le besoin n'est pas Excel : c'est de pouvoir totaliser une colonne de notes
 * ou faire une moyenne sans sortir de sa prise de notes. On implémente donc un
 * sous-ensemble volontairement étroit, mais correct : références, plages,
 * quatre fonctions, arithmétique, et une détection de cycle.
 *
 * Conventions retenues, celles d'Excel en français :
 *
 * - les arguments sont séparés par `;`, pas par une virgule ;
 * - dans une cellule simple, la virgule décimale est acceptée (« 3,5 ») ;
 *   dans une formule, le point seul, sans quoi `SOMME(1,5;2)` serait ambigu.
 *
 * Les erreurs sont des valeurs, pas des exceptions : une cellule fautive
 * affiche `#REF`, `#CYCLE`, `#VAL` ou `#DIV0` et les autres continuent de se
 * calculer. Un tableau ne doit pas devenir illisible pour une faute de frappe.
 */

export type Sheet = string[][];

export type CellValue = {
  /** Ce qui s'affiche dans la cellule. */
  text: string;
  /** Valeur numérique, ou nulle si la cellule est du texte ou en erreur. */
  numeric: number | null;
  error?: string;
};

const FUNCTIONS = new Set(["SOMME", "SUM", "MOYENNE", "AVERAGE", "MIN", "MAX", "NB", "COUNT"]);

/** Nom de colonne à partir de son rang : 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name;
  }
  return name;
}

/** Rang d'une colonne à partir de son nom : A → 0, AA → 26. */
export function columnIndex(name: string): number {
  let index = 0;
  for (const char of name.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

export type Ref = { row: number; col: number };

/** Analyse « B3 » en { row: 2, col: 1 }. Nul si ce n'en est pas une. */
export function parseRef(text: string): Ref | null {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(text.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  if (row < 0) return null;
  return { row, col: columnIndex(match[1]) };
}

/**
 * Nombre écrit dans une cellule simple. La virgule décimale est acceptée : sur
 * un clavier français, c'est ce que produit la touche du pavé numérique.
 */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  return Number(normalized);
}

export function isFormula(text: string): boolean {
  return text.trimStart().startsWith("=");
}

/**
 * Évalue toute la grille et renvoie ce qu'il faut afficher.
 *
 * Le calcul est fait à la demande, avec mémoïsation : une cellule référencée
 * par dix autres n'est évaluée qu'une fois, et le chemin de visite en cours
 * sert à repérer les cycles.
 */
export function evaluateSheet(sheet: Sheet): CellValue[][] {
  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();

  const raw = (row: number, col: number): string => sheet[row]?.[col] ?? "";
  const key = (row: number, col: number) => `${row}:${col}`;

  function evaluate(row: number, col: number): CellValue {
    const k = key(row, col);
    const memo = cache.get(k);
    if (memo) return memo;

    // Une cellule qui se référence, directement ou par un détour, n'a pas de
    // valeur : on le dit plutôt que de boucler jusqu'à la pile pleine.
    if (visiting.has(k)) return { text: "#CYCLE", numeric: null, error: "#CYCLE" };

    const text = raw(row, col);
    let result: CellValue;

    if (!isFormula(text)) {
      const numeric = parseNumber(text);
      result = { text: text.trim(), numeric };
    } else {
      visiting.add(k);
      try {
        const value = new Parser(text.trimStart().slice(1), cellNumber).parse();
        result =
          typeof value === "number"
            ? { text: formatNumber(value), numeric: value }
            : { text: value, numeric: null, error: value };
      } finally {
        visiting.delete(k);
      }
    }

    cache.set(k, result);
    return result;
  }

  /** Valeur numérique d'une cellule, telle que la voit une formule. */
  function cellNumber(ref: Ref): number | string {
    if (ref.row < 0 || ref.col < 0 || ref.row >= sheet.length) return "#REF";
    const value = evaluate(ref.row, ref.col);
    if (value.error) return value.error;
    // Une cellule vide compte pour zéro, comme dans tout tableur ; du texte
    // dans un calcul est en revanche une erreur, et non un zéro silencieux.
    if (value.numeric === null) return value.text === "" ? 0 : "#VAL";
    return value.numeric;
  }

  const height = sheet.length;
  const width = sheet.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => evaluate(row, col)),
  );
}

/**
 * Arrondi d'affichage : les flottants binaires donnent 0.30000000000000004
 * pour 0.1 + 0.2, ce qui n'a pas sa place dans une cellule.
 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "#DIV0";
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

/**
 * Analyseur descendant récursif.
 *
 *   expression := terme (('+' | '-') terme)*
 *   terme      := facteur (('*' | '/') facteur)*
 *   facteur    := '-' facteur | nombre | appel | référence | '(' expression ')'
 *   appel      := NOM '(' argument (';' argument)* ')'
 *   argument   := plage | expression
 *   plage      := référence ':' référence
 */
class Parser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly cell: (ref: Ref) => number | string,
  ) {}

  parse(): number | string {
    try {
      const value = this.expression();
      this.skipSpaces();
      // Du texte après la fin de l'expression signale une faute de frappe,
      // pas une expression valide qu'on pourrait deviner.
      if (this.pos < this.source.length) return "#ERR";
      return Number.isFinite(value) ? value : "#DIV0";
    } catch (error) {
      return error instanceof CellError ? error.code : "#ERR";
    }
  }

  private skipSpaces() {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) this.pos++;
  }

  private peek(): string {
    this.skipSpaces();
    return this.source[this.pos] ?? "";
  }

  private eat(char: string): boolean {
    if (this.peek() !== char) return false;
    this.pos++;
    return true;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      if (this.eat("+")) value += this.term();
      else if (this.eat("-")) value -= this.term();
      else return value;
    }
  }

  private term(): number {
    let value = this.factor();
    for (;;) {
      if (this.eat("*")) value *= this.factor();
      else if (this.eat("/")) {
        const divisor = this.factor();
        if (divisor === 0) throw new CellError("#DIV0");
        value /= divisor;
      } else return value;
    }
  }

  private factor(): number {
    if (this.eat("-")) return -this.factor();
    if (this.eat("+")) return this.factor();
    if (this.eat("(")) {
      const value = this.expression();
      if (!this.eat(")")) throw new CellError("#ERR");
      return value;
    }

    const char = this.peek();
    if (/[0-9.]/.test(char)) return this.number();
    if (/[A-Za-z]/.test(char)) return this.nameOrCall();
    throw new CellError("#ERR");
  }

  private number(): number {
    this.skipSpaces();
    const start = this.pos;
    while (/[0-9.]/.test(this.source[this.pos] ?? "")) this.pos++;
    const value = Number(this.source.slice(start, this.pos));
    if (!Number.isFinite(value)) throw new CellError("#ERR");
    return value;
  }

  /** Un nom est soit un appel de fonction, soit une référence de cellule. */
  private nameOrCall(): number {
    this.skipSpaces();
    const start = this.pos;
    while (/[A-Za-z0-9]/.test(this.source[this.pos] ?? "")) this.pos++;
    const word = this.source.slice(start, this.pos);

    if (this.peek() === "(") {
      const name = word.toUpperCase();
      if (!FUNCTIONS.has(name)) throw new CellError("#NOM");
      this.eat("(");
      const values = this.args();
      if (!this.eat(")")) throw new CellError("#ERR");
      return apply(name, values);
    }

    const ref = parseRef(word);
    if (!ref) throw new CellError("#REF");
    return this.value(ref);
  }

  private args(): number[] {
    const values: number[] = [];
    // Appel sans argument : SOMME() vaut zéro, comme dans un tableur.
    if (this.peek() === ")") return values;

    do {
      values.push(...this.argument());
    } while (this.eat(";"));
    return values;
  }

  /** Un argument est une plage — qui vaut plusieurs nombres — ou une expression. */
  private argument(): number[] {
    const save = this.pos;
    this.skipSpaces();
    const start = this.pos;
    while (/[A-Za-z0-9]/.test(this.source[this.pos] ?? "")) this.pos++;
    const word = this.source.slice(start, this.pos);
    const from = parseRef(word);

    if (from && this.peek() === ":") {
      this.eat(":");
      this.skipSpaces();
      const s2 = this.pos;
      while (/[A-Za-z0-9]/.test(this.source[this.pos] ?? "")) this.pos++;
      const to = parseRef(this.source.slice(s2, this.pos));
      if (!to) throw new CellError("#REF");
      return this.range(from, to);
    }

    // Ce n'était pas une plage : on rembobine et on lit une expression.
    this.pos = save;
    return [this.expression()];
  }

  private range(from: Ref, to: Ref): number[] {
    const values: number[] = [];
    const rows = [Math.min(from.row, to.row), Math.max(from.row, to.row)];
    const cols = [Math.min(from.col, to.col), Math.max(from.col, to.col)];
    for (let row = rows[0]; row <= rows[1]; row++) {
      for (let col = cols[0]; col <= cols[1]; col++) {
        values.push(this.value({ row, col }));
      }
    }
    return values;
  }

  private value(ref: Ref): number {
    const value = this.cell(ref);
    if (typeof value === "string") throw new CellError(value);
    return value;
  }
}

function apply(name: string, values: number[]): number {
  switch (name) {
    case "SOMME":
    case "SUM":
      return values.reduce((sum, v) => sum + v, 0);
    case "MOYENNE":
    case "AVERAGE":
      if (values.length === 0) throw new CellError("#DIV0");
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    case "MIN":
      if (values.length === 0) throw new CellError("#ERR");
      return Math.min(...values);
    case "MAX":
      if (values.length === 0) throw new CellError("#ERR");
      return Math.max(...values);
    case "NB":
    case "COUNT":
      return values.length;
    default:
      throw new CellError("#NOM");
  }
}

class CellError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
