/**
 * TacScript, stage one: text to a tree of blocks.
 *
 * The grammar is deliberately uniform - every line in the language is
 *
 *     keyword arg arg ... [{ nested lines }]
 *
 * and nothing else. A thirteen-year-old writing their first Tac-On only has to
 * learn one shape, and the compiler in `compile.ts` gets to do all the real
 * checking with line numbers attached to everything.
 *
 * Whitespace is not significant. Newlines are: a statement ends at the end of
 * its line, or at a brace. Commas are separators and are thrown away, so
 * `columns hero, amount` and `columns hero amount` mean the same thing.
 */

import type { Diagnostic } from "./types";

export type TokenKind = "word" | "string" | "number" | "colon" | "open" | "close" | "newline";

export type Token = {
  kind: TokenKind;
  /** For strings this is the decoded text; for numbers, the digits as typed. */
  value: string;
  line: number;
  column: number;
};

export type Node = {
  keyword: string;
  /** Everything after the keyword, commas removed. */
  args: Token[];
  children: Node[];
  line: number;
  column: number;
};

export type ParseResult = { nodes: Node[]; diagnostics: Diagnostic[] };

const WORD_CHARS = /[A-Za-z0-9_.\-/*]/;

export function tokenize(source: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];

  let index = 0;
  let line = 1;
  let column = 1;

  const push = (kind: TokenKind, value: string, startLine: number, startColumn: number) => {
    tokens.push({ kind, value, line: startLine, column: startColumn });
  };

  while (index < source.length) {
    const char = source[index];

    if (char === "\n") {
      push("newline", "\n", line, column);
      index += 1;
      line += 1;
      column = 1;
      continue;
    }

    if (char === " " || char === "\t" || char === "\r") {
      index += 1;
      column += 1;
      continue;
    }

    // Comments run to the end of the line. `#` is the only comment marker -
    // `//` would collide with dates and paths people type without thinking.
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === ",") {
      index += 1;
      column += 1;
      continue;
    }

    if (char === "{" || char === "}") {
      push(char === "{" ? "open" : "close", char, line, column);
      index += 1;
      column += 1;
      continue;
    }

    if (char === ":") {
      push("colon", ":", line, column);
      index += 1;
      column += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const startLine = line;
      const startColumn = column;
      index += 1;
      column += 1;
      let text = "";
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === "\\" && index + 1 < source.length) {
          const next = source[index + 1];
          text += next === "n" ? "\n" : next;
          index += 2;
          column += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          column += 1;
          break;
        }
        if (current === "\n") break; // A string never spans a line - that's a typo.
        text += current;
        index += 1;
        column += 1;
      }
      if (!closed) {
        diagnostics.push({
          line: startLine,
          column: startColumn,
          severity: "error",
          message: "This text is missing its closing quote.",
        });
      }
      push("string", text, startLine, startColumn);
      continue;
    }

    if (WORD_CHARS.test(char)) {
      const startLine = line;
      const startColumn = column;
      let text = "";
      while (index < source.length && WORD_CHARS.test(source[index])) {
        text += source[index];
        index += 1;
        column += 1;
      }
      const numeric = /^-?\d+(\.\d+)?$/.test(text);
      push(numeric ? "number" : "word", text, startLine, startColumn);
      continue;
    }

    diagnostics.push({
      line,
      column,
      severity: "error",
      message: `"${char}" doesn't mean anything in a Tac-On.`,
    });
    index += 1;
    column += 1;
  }

  push("newline", "\n", line, column);
  return { tokens, diagnostics };
}

/**
 * Tokens to blocks. Unbalanced braces are reported rather than thrown - a
 * half-written Tac-On in the editor should still show every other mistake in
 * the file, not just the first one.
 */
export function parse(source: string): ParseResult {
  const { tokens, diagnostics } = tokenize(source);
  let position = 0;

  const peek = (): Token => tokens[position] ?? tokens[tokens.length - 1];
  const atEnd = () => position >= tokens.length;

  function parseBlock(depth: number): Node[] {
    const nodes: Node[] = [];

    while (!atEnd()) {
      const token = peek();

      if (token.kind === "newline") {
        position += 1;
        continue;
      }

      if (token.kind === "close") {
        if (depth === 0) {
          diagnostics.push({
            line: token.line,
            column: token.column,
            severity: "error",
            message: "There's a closing brace here with nothing open.",
          });
          position += 1;
          continue;
        }
        return nodes;
      }

      if (token.kind === "open") {
        diagnostics.push({
          line: token.line,
          column: token.column,
          severity: "error",
          message: "A block needs a name in front of its opening brace.",
        });
        position += 1;
        continue;
      }

      // A statement: keyword, then arguments up to a newline or a brace.
      const keywordToken = token;
      position += 1;
      const args: Token[] = [];
      let children: Node[] = [];

      while (!atEnd()) {
        const next = peek();
        if (next.kind === "newline") {
          position += 1;
          break;
        }
        if (next.kind === "close") break;
        if (next.kind === "open") {
          position += 1;
          children = parseBlock(depth + 1);
          const closing = peek();
          if (closing && closing.kind === "close") {
            position += 1;
          } else {
            diagnostics.push({
              line: next.line,
              column: next.column,
              severity: "error",
              message: `"${keywordToken.value}" opens a block that is never closed.`,
            });
          }
          break;
        }
        args.push(next);
        position += 1;
      }

      nodes.push({
        keyword: keywordToken.value,
        args,
        children,
        line: keywordToken.line,
        column: keywordToken.column,
      });
    }

    return nodes;
  }

  const nodes = parseBlock(0);
  return { nodes, diagnostics };
}

/* -------------------------------------------------------------------------- */
/*  Small helpers the compiler leans on                                        */
/* -------------------------------------------------------------------------- */

/** The plain text of an argument, whether it was quoted or not. */
export function text(token: Token | undefined): string {
  return token?.value ?? "";
}

/** Every argument joined back into one string - for free-text like a title. */
export function joined(args: Token[]): string {
  return args.map((token) => token.value).join(" ").trim();
}

/** Arguments as a list of bare words: `allow admin, secretary`. */
export function words(args: Token[]): string[] {
  return args
    .filter((token) => token.kind === "word" || token.kind === "string")
    .map((token) => token.value.trim())
    .filter(Boolean);
}
