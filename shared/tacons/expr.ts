/**
 * TacScript expressions: the only part of the language that computes anything.
 *
 * Expressions are an AST, never code. They are parsed once at publish time and
 * evaluated by walking the tree, so a Tac-On can add up a ledger or filter a
 * list without the app ever running a line of someone else's JavaScript.
 *
 * The vocabulary is small on purpose, and reads as English:
 *
 *     sum of entry.amount where entry.kind is "earn"
 *     count of entry where entry.hero is me.id
 *     setting.rate times 2
 *     "You have {my.balance} bucks"
 */

import type { Token } from "./parse";
import { DAY_RE, dayInZone, startOfDayInZone } from "../calendar";
import {
  AGGREGATES,
  CLOCK_WORDS,
  ROW_AGGREGATES,
  type Aggregate,
  type ClockWord,
  type Comparator,
  type Comparison,
  type Condition,
  type Diagnostic,
  type Expr,
} from "./types";

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

type Cursor = { tokens: Token[]; index: number; diagnostics: Diagnostic[]; line: number };

function peek(cursor: Cursor): Token | undefined {
  return cursor.tokens[cursor.index];
}

function take(cursor: Cursor): Token | undefined {
  const token = cursor.tokens[cursor.index];
  cursor.index += 1;
  return token;
}

function atWord(cursor: Cursor, word: string): boolean {
  const token = peek(cursor);
  return token?.kind === "word" && token.value.toLowerCase() === word;
}

function fail(cursor: Cursor, message: string): void {
  const token = peek(cursor) ?? cursor.tokens[cursor.tokens.length - 1];
  cursor.diagnostics.push({
    line: token?.line ?? cursor.line,
    column: token?.column ?? 1,
    severity: "error",
    message,
  });
}

const BINARY_WORDS: Record<string, "plus" | "minus" | "times" | "divided"> = {
  plus: "plus",
  minus: "minus",
  times: "times",
  divided: "divided",
};

function parseValue(cursor: Cursor): Expr | null {
  const token = take(cursor);
  if (!token) {
    fail(cursor, "Something is missing here - this needs a value.");
    return null;
  }

  if (token.kind === "string") return parseTemplate(token.value, token.line, cursor.diagnostics);
  if (token.kind === "number") return { kind: "literal", value: Number(token.value) };
  if (token.kind === "word") {
    const lower = token.value.toLowerCase();
    if (lower === "true" || lower === "yes") return { kind: "literal", value: true };
    if (lower === "false" || lower === "no") return { kind: "literal", value: false };
    if (lower === "nothing" || lower === "none") return { kind: "literal", value: "" };
    return { kind: "path", parts: token.value.split(".").filter(Boolean) };
  }

  cursor.diagnostics.push({
    line: token.line,
    column: token.column,
    severity: "error",
    message: `"${token.value}" can't be used as a value.`,
  });
  return null;
}

function parseAggregate(cursor: Cursor): Expr | null {
  const fnToken = take(cursor)!;
  const fn = fnToken.value.toLowerCase() as Aggregate;

  if (!atWord(cursor, "of")) {
    fail(cursor, `Write it as "${fn} of <store>.<field>".`);
    return null;
  }
  take(cursor);

  const target = take(cursor);
  if (!target || target.kind !== "word") {
    fail(cursor, `"${fn} of" needs the name of a store, like "${fn} of entry.amount".`);
    return null;
  }

  const parts = target.value.split(".").filter(Boolean);
  let source: string[];
  let field: string | null;
  if (ROW_AGGREGATES.includes(fn)) {
    source = parts;
    field = null;
  } else {
    if (parts.length < 2) {
      cursor.diagnostics.push({
        line: target.line,
        column: target.column,
        severity: "error",
        message: `"${fn}" needs a field to work on, like "${fn} of entry.amount".`,
      });
      return null;
    }
    field = parts[parts.length - 1];
    source = parts.slice(0, -1);
  }

  let where: Condition | null = null;
  if (atWord(cursor, "where")) {
    take(cursor);
    where = parseConditionFrom(cursor);
  }

  return { kind: "aggregate", fn, source, field, where };
}

export function parseExpr(tokens: Token[], line: number, diagnostics: Diagnostic[]): Expr | null {
  const cursor: Cursor = { tokens, index: 0, diagnostics, line };
  const expr = parseExprFrom(cursor);
  if (expr && cursor.index < cursor.tokens.length) {
    const leftover = cursor.tokens[cursor.index];
    diagnostics.push({
      line: leftover.line,
      column: leftover.column,
      severity: "warning",
      message: `"${leftover.value}" here isn't part of the value and was ignored.`,
    });
  }
  return expr;
}

function parseExprFrom(cursor: Cursor): Expr | null {
  if (!peek(cursor)) {
    fail(cursor, "This needs a value.");
    return null;
  }

  let left = parseOperand(cursor);
  if (!left) return null;

  // `a minus b plus c` reads strictly left to right: ((a minus b) plus c).
  // Each pass takes one operand, never a whole expression, so nothing groups
  // to the right. Anyone who needs real precedence is writing something a
  // Tac-On should not be doing.
  while (peek(cursor)?.kind === "word") {
    const op = BINARY_WORDS[peek(cursor)!.value.toLowerCase()];
    if (!op) break;
    take(cursor);
    if (op === "divided" && atWord(cursor, "by")) take(cursor);
    const right = parseOperand(cursor);
    if (!right) return left;
    left = { kind: "binary", op, left, right };
  }

  return left;
}

/** The word after the one under the cursor, lower-cased. */
function nextWord(cursor: Cursor): string | null {
  const token = cursor.tokens[cursor.index + 1];
  return token?.kind === "word" ? token.value.toLowerCase() : null;
}

/**
 * One value with no arithmetic around it: a plain value, a total, or one of
 * the small forms (`max of`, `min of`, `if ... then ... else`, `name of`).
 */
function parseOperand(cursor: Cursor): Expr | null {
  const token = peek(cursor);
  if (!token) {
    fail(cursor, "This needs a value.");
    return null;
  }
  const lower = token.kind === "word" ? token.value.toLowerCase() : "";

  if ((AGGREGATES as readonly string[]).includes(lower)) return parseAggregate(cursor);

  // `max of 0 and setting.goal minus my.done`: everything after `and` is the
  // second value, arithmetic included.
  if ((lower === "max" || lower === "min") && nextWord(cursor) === "of") {
    take(cursor);
    take(cursor);
    const left = parseExprFrom(cursor);
    if (!left) return null;
    if (!atWord(cursor, "and")) {
      fail(cursor, `Write it as "${lower} of <value> and <value>".`);
      return null;
    }
    take(cursor);
    const right = parseExprFrom(cursor);
    if (!right) return null;
    return { kind: "pick", fn: lower, left, right };
  }

  if (lower === "name" && nextWord(cursor) === "of") {
    take(cursor);
    take(cursor);
    const of = parseOperand(cursor);
    return of ? { kind: "name", of } : null;
  }

  if (lower === "if" && cursor.index + 1 < cursor.tokens.length) {
    take(cursor);
    const when = parseConditionFrom(cursor);
    if (!when) return null;
    if (!atWord(cursor, "then")) {
      fail(cursor, 'Write it as "if <test> then <value> else <value>".');
      return null;
    }
    take(cursor);
    const then = parseExprFrom(cursor);
    if (!then) return null;
    if (!atWord(cursor, "else") && !atWord(cursor, "otherwise")) {
      fail(cursor, 'An "if" needs an "else", so there is always a value.');
      return null;
    }
    take(cursor);
    const otherwise = parseExprFrom(cursor);
    if (!otherwise) return null;
    return { kind: "if", when, then, otherwise };
  }

  return parseValue(cursor);
}

export function parseCondition(
  tokens: Token[],
  line: number,
  diagnostics: Diagnostic[],
): Condition | null {
  return parseConditionFrom({ tokens, index: 0, diagnostics, line });
}

function parseConditionFrom(cursor: Cursor): Condition | null {
  const all: Comparison[] = [];
  for (;;) {
    const comparison = parseComparison(cursor);
    if (!comparison) break;
    all.push(comparison);
    if (atWord(cursor, "and")) {
      take(cursor);
      continue;
    }
    break;
  }

  return all.length > 0 ? { all } : null;
}

function parseComparison(cursor: Cursor): Comparison | null {
  const left = parseValue(cursor);
  if (!left) return null;

  const opToken = take(cursor);
  if (!opToken || opToken.kind !== "word") {
    fail(cursor, 'A test looks like `entry.kind is "earn"`.');
    return null;
  }

  let op: Comparator;
  switch (opToken.value.toLowerCase()) {
    case "is":
      if (atWord(cursor, "not")) {
        take(cursor);
        op = "is not";
      } else {
        op = "is";
      }
      break;
    case "above":
    case "over":
      op = "above";
      break;
    case "below":
    case "under":
      op = "below";
      break;
    case "contains":
    case "includes":
      op = "contains";
      break;
    default:
      cursor.diagnostics.push({
        line: opToken.line,
        column: opToken.column,
        severity: "error",
        message: `"${opToken.value}" isn't a test. Use is, is not, above, below or contains.`,
      });
      return null;
  }

  const right = parseValue(cursor);
  if (!right) return null;
  return { left, op, right };
}

/**
 * Turns `"You have {my.balance} bucks"` into a template expression. A string
 * with no braces compiles to a plain literal, so the common case costs nothing.
 */
export function parseTemplate(raw: string, line: number, diagnostics: Diagnostic[]): Expr {
  if (!raw.includes("{")) return { kind: "literal", value: raw };

  const parts: (string | Expr)[] = [];
  let buffer = "";
  let index = 0;

  while (index < raw.length) {
    const char = raw[index];
    if (char === "{") {
      const end = raw.indexOf("}", index);
      if (end === -1) {
        diagnostics.push({
          line,
          column: 1,
          severity: "error",
          message: "This text opens a { that is never closed.",
        });
        buffer += raw.slice(index);
        break;
      }
      if (buffer) {
        parts.push(buffer);
        buffer = "";
      }
      const inner = raw.slice(index + 1, end).trim();
      // The inside of the braces is a tiny expression in its own right.
      const embedded = tokenizeInline(inner, line);
      const expr = parseExpr(embedded, line, diagnostics);
      parts.push(expr ?? { kind: "literal", value: "" });
      index = end + 1;
      continue;
    }
    buffer += char;
    index += 1;
  }

  if (buffer) parts.push(buffer);
  return { kind: "template", parts };
}

/** A miniature tokenizer for the inside of `{...}`. Words, numbers, strings. */
function tokenizeInline(source: string, line: number): Token[] {
  const tokens: Token[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?)|([A-Za-z0-9_.\-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const column = match.index + 1;
    if (match[1] !== undefined || match[2] !== undefined) {
      tokens.push({ kind: "string", value: match[1] ?? match[2] ?? "", line, column });
    } else if (match[3] !== undefined) {
      tokens.push({ kind: "number", value: match[3], line, column });
    } else {
      tokens.push({ kind: "word", value: match[4], line, column });
    }
  }
  return tokens;
}

/* -------------------------------------------------------------------------- */
/*  Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export type Row = Record<string, unknown>;

export type EvalContext = {
  /** The person looking at the page: id, name, role, studioId. */
  me: Row;
  /** Only populated inside a hook. */
  event: Row;
  /** What the installing admin filled in. */
  setting: Row;
  /** The row being tested, inside a `where` or a list column. */
  row: Row | null;
  /** Names that currently mean "the row being tested" - the store's own name. */
  rowAliases: string[];
  /** Rows for a store, by path: ["entry"] or ["bucks", "entry"]. */
  records: (source: string[]) => Row[];
  /** Named values: ["balance"] for our own, ["bucks", "balance"] for another's. */
  compute: (path: string[]) => unknown;
  /**
   * The Tac-On's own positions, by name: `{ names, holder, holders, title }`.
   * `position.treasurer` reads the names; `.holder` is the first holder's id.
   */
  positions: Record<string, Row>;
  /** `today`, `this_week_start`, `session_start`, `weekday`. Absent means blank. */
  clock?: Partial<Record<ClockWord, string>>;
  /** The academy's time zone, for comparing a saved moment with a day. */
  timeZone?: string | null;
  /** A person's name from their id, for `name of`. */
  personName?: (id: unknown) => string | undefined;
};

export function evaluate(expr: Expr | null, ctx: EvalContext): unknown {
  if (!expr) return undefined;

  switch (expr.kind) {
    case "literal":
      return expr.value;

    case "pick": {
      const left = toNumber(evaluate(expr.left, ctx));
      const right = toNumber(evaluate(expr.right, ctx));
      return expr.fn === "max" ? Math.max(left, right) : Math.min(left, right);
    }

    case "if":
      return matches(expr.when, ctx) ? evaluate(expr.then, ctx) : evaluate(expr.otherwise, ctx);

    case "name": {
      const value = evaluate(expr.of, ctx);
      if (value === null || value === undefined || value === "") return "";
      return ctx.personName?.(value) ?? display(value);
    }

    case "template":
      return expr.parts
        .map((part) => (typeof part === "string" ? part : display(evaluate(part, ctx))))
        .join("");

    case "path":
      return resolvePath(expr.parts, ctx);

    case "binary": {
      const left = toNumber(evaluate(expr.left, ctx));
      const right = toNumber(evaluate(expr.right, ctx));
      switch (expr.op) {
        case "plus":
          return left + right;
        case "minus":
          return left - right;
        case "times":
          return left * right;
        case "divided":
          return right === 0 ? 0 : left / right;
      }
      return 0;
    }

    case "aggregate": {
      const storeName = expr.source[expr.source.length - 1];
      const rows = ctx.records(expr.source).filter((row) =>
        expr.where
          ? matches(expr.where, { ...ctx, row, rowAliases: [storeName, "row", "it"] })
          : true,
      );
      if (expr.fn === "count") return rows.length;
      if (expr.fn === "any") return rows.length > 0 ? 1 : 0;

      const numbers = rows.map((row) => toNumber(row[expr.field!]));
      if (numbers.length === 0) return 0;
      switch (expr.fn) {
        case "sum":
          return numbers.reduce((total, value) => total + value, 0);
        case "average":
          return numbers.reduce((total, value) => total + value, 0) / numbers.length;
        case "highest":
          return Math.max(...numbers);
        case "lowest":
          return Math.min(...numbers);
      }
      return 0;
    }
  }
}

function resolvePath(parts: string[], ctx: EvalContext): unknown {
  if (parts.length === 0) return undefined;
  const [root, ...rest] = parts;
  const lower = root.toLowerCase();

  if (lower === "me" || lower === "my" || lower === "i") {
    // `my.balance` reads a computed value; `me.name` reads the viewer.
    if (lower === "my") return ctx.compute(rest);
    return dig(ctx.me, rest);
  }
  if (lower === "event") return dig(ctx.event, rest);
  if ((lower === "position" || lower === "positions") && rest.length > 0) {
    // `position.treasurer` on its own means who holds it, as words.
    const [name, ...field] = rest;
    return dig(ctx.positions[name] ?? { names: "nobody yet", holder: null, holders: 0 }, field.length ? field : ["names"]);
  }
  if (lower === "setting" || lower === "settings") return dig(ctx.setting, rest);
  if (lower === "row" || lower === "it" || lower === "this") return dig(ctx.row ?? {}, rest);
  if (ctx.rowAliases.includes(root)) return dig(ctx.row ?? {}, rest);

  // A bare field name inside a row context: `amount` rather than `entry.amount`.
  if (rest.length === 0 && ctx.row && root in ctx.row) return ctx.row[root];

  // The clock comes after a row's own fields, so a field called `weekday` wins.
  if (rest.length === 0 && (CLOCK_WORDS as readonly string[]).includes(lower)) {
    return ctx.clock?.[lower as ClockWord] ?? "";
  }

  // Anything left is another Tac-On's published value.
  return ctx.compute(parts);
}

function dig(source: Row, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Row)[key];
  }
  return current;
}

export function matches(condition: Condition | null, ctx: EvalContext): boolean {
  if (!condition) return true;
  return condition.all.every((comparison) => {
    const left = evaluate(comparison.left, ctx);
    const right = evaluate(comparison.right, ctx);
    switch (comparison.op) {
      case "is":
        return sameMoment(left, right, ctx) ?? same(left, right);
      case "is not":
        return !(sameMoment(left, right, ctx) ?? same(left, right));
      case "above":
      case "below": {
        // Two dates (a day, or a saved moment like `created`) compare in time.
        // A day means its first moment, so `created above today` is "saved
        // today" and `due below today` is "due before today".
        const a = momentOf(left, ctx);
        const b = momentOf(right, ctx);
        if (a !== null && b !== null) return comparison.op === "above" ? a > b : a < b;
        return comparison.op === "above"
          ? toNumber(left) > toNumber(right)
          : toNumber(left) < toNumber(right);
      }
      case "contains":
        return display(left).toLowerCase().includes(display(right).toLowerCase());
    }
    return false;
  });
}

const MOMENT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Epoch milliseconds for a day or a timestamp string; null for anything else. */
function momentOf(value: unknown, ctx: EvalContext): number | null {
  if (typeof value !== "string") return null;
  if (DAY_RE.test(value)) return startOfDayInZone(value, ctx.timeZone);
  if (MOMENT_RE.test(value)) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

/**
 * `created is today`: a saved moment is "the same" as a day when it falls on
 * that day in the academy's time zone. Null when this isn't a day-and-moment
 * pair, so the ordinary test applies.
 */
function sameMoment(left: unknown, right: unknown, ctx: EvalContext): boolean | null {
  if (typeof left !== "string" || typeof right !== "string") return null;
  const dayOf = (moment: string) => dayInZone(new Date(moment), ctx.timeZone);
  if (DAY_RE.test(left) && MOMENT_RE.test(right)) return dayOf(right) === left;
  if (MOMENT_RE.test(left) && DAY_RE.test(right)) return dayOf(left) === right;
  return null;
}

/** Loose equality, because `5` typed into a form and 5 in the store are one thing. */
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? "") === (right ?? "");
  }
  if (typeof left === "number" || typeof right === "number") {
    const a = toNumber(left);
    const b = toNumber(right);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  }
  return display(left).toLowerCase() === display(right).toLowerCase();
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
