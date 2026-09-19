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
import {
  AGGREGATES,
  type Aggregate,
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
  if (fn === "count") {
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
  const token = peek(cursor);
  if (!token) {
    fail(cursor, "This needs a value.");
    return null;
  }

  let left =
    token.kind === "word" && (AGGREGATES as readonly string[]).includes(token.value.toLowerCase())
      ? parseAggregate(cursor)
      : parseValue(cursor);
  if (!left) return null;

  // `a plus b times c` reads strictly left to right. Anyone who needs real
  // precedence is writing something a Tac-On should not be doing.
  while (peek(cursor)?.kind === "word") {
    const op = BINARY_WORDS[peek(cursor)!.value.toLowerCase()];
    if (!op) break;
    take(cursor);
    if (op === "divided" && atWord(cursor, "by")) take(cursor);
    const right = parseExprFrom(cursor);
    if (!right) return left;
    left = { kind: "binary", op, left, right };
  }

  return left;
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
};

export function evaluate(expr: Expr | null, ctx: EvalContext): unknown {
  if (!expr) return undefined;

  switch (expr.kind) {
    case "literal":
      return expr.value;

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
  if (lower === "setting" || lower === "settings") return dig(ctx.setting, rest);
  if (lower === "row" || lower === "it" || lower === "this") return dig(ctx.row ?? {}, rest);
  if (ctx.rowAliases.includes(root)) return dig(ctx.row ?? {}, rest);

  // A bare field name inside a row context: `amount` rather than `entry.amount`.
  if (rest.length === 0 && ctx.row && root in ctx.row) return ctx.row[root];

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
        return same(left, right);
      case "is not":
        return !same(left, right);
      case "above":
        return toNumber(left) > toNumber(right);
      case "below":
        return toNumber(left) < toNumber(right);
      case "contains":
        return display(left).toLowerCase().includes(display(right).toLowerCase());
    }
    return false;
  });
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
