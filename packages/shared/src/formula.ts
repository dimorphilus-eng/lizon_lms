/**
 * Крошечный разбор математических формул для вычисляемых вопросов.
 * Разрешены числа, скобки, + - * / ^, переменные и функции abs/sqrt/min/max/round.
 * Произвольный JavaScript не исполняется.
 */

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const FUNCTIONS = new Set(["abs", "sqrt", "min", "max", "round"]);

export function formulaVariables(formula: string): string[] {
  const normalized = normalizeFormula(formula);
  const tokens = tokenize(normalized);
  const names = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.t !== "id") continue;
    const next = tokens[i + 1];
    if (next?.t === "lp") {
      if (!FUNCTIONS.has(token.v)) {
        throw new FormulaError(`unknown function ${token.v}`);
      }
      continue;
    }
    names.add(token.v);
  }
  return [...names];
}

export function evaluateFormula(formula: string, variables: Record<string, number>): number {
  const normalized = normalizeFormula(formula);
  const tokens = tokenize(normalized);
  let index = 0;

  const peek = () => tokens[index];
  const eat = () => {
    const token = tokens[index];
    if (!token) throw new FormulaError("unexpected end of formula");
    index += 1;
    return token;
  };

  const parseExpr = (): number => {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || (token.v !== "+" && token.v !== "-")) break;
      eat();
      const right = parseTerm();
      value = token.v === "+" ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parsePower();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || (token.v !== "*" && token.v !== "/")) break;
      eat();
      const right = parsePower();
      if (token.v === "/" && right === 0) throw new FormulaError("division by zero");
      value = token.v === "*" ? value * right : value / right;
    }
    return value;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    const token = peek();
    if (token?.t === "op" && token.v === "^") {
      eat();
      return base ** parsePower();
    }
    return base;
  };

  const parseUnary = (): number => {
    const token = peek();
    if (token?.t === "op" && (token.v === "-" || token.v === "+")) {
      eat();
      const value = parseUnary();
      return token.v === "-" ? -value : value;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const token = eat();
    if (token.t === "num") return token.v;
    if (token.t === "lp") {
      const value = parseExpr();
      const close = eat();
      if (close.t !== "rp") throw new FormulaError("expected )");
      return value;
    }
    if (token.t === "id") {
      if (peek()?.t === "lp") {
        if (!FUNCTIONS.has(token.v)) throw new FormulaError(`unknown function ${token.v}`);
        eat();
        const args: number[] = [];
        if (peek()?.t !== "rp") {
          args.push(parseExpr());
          while (peek()?.t === "comma") {
            eat();
            args.push(parseExpr());
          }
        }
        const close = eat();
        if (close.t !== "rp") throw new FormulaError("expected )");
        return applyFunction(token.v, args);
      }
      if (!(token.v in variables)) throw new FormulaError(`unknown variable ${token.v}`);
      const value = variables[token.v];
      if (!Number.isFinite(value)) throw new FormulaError(`variable ${token.v} is not finite`);
      return value;
    }
    throw new FormulaError("expected value");
  };

  if (tokens.length === 0) throw new FormulaError("empty formula");
  const result = parseExpr();
  if (index !== tokens.length) throw new FormulaError("unexpected trailing token");
  if (!Number.isFinite(result)) throw new FormulaError("formula result is not finite");
  return result;
}

export function assertFormula(formula: string, allowed: string[]): void {
  const used = formulaVariables(formula);
  for (const name of used) {
    if (!allowed.includes(name)) throw new FormulaError(`unknown variable ${name}`);
  }
  const sample: Record<string, number> = {};
  for (const name of allowed) sample[name] = 1;
  for (const name of used) sample[name] = 1;
  evaluateFormula(formula, sample);
}

function applyFunction(name: string, args: number[]): number {
  if (name === "abs") return unary(name, args, Math.abs);
  if (name === "sqrt") {
    const value = unary(name, args, (n) => n);
    if (value < 0) throw new FormulaError("sqrt of negative");
    return Math.sqrt(value);
  }
  if (name === "round") return unary(name, args, Math.round);
  if (name === "min" || name === "max") {
    if (args.length === 0) throw new FormulaError(`${name} expects arguments`);
    return name === "min" ? Math.min(...args) : Math.max(...args);
  }
  throw new FormulaError(`unknown function ${name}`);
}

function unary(name: string, args: number[], fn: (n: number) => number): number {
  if (args.length !== 1) throw new FormulaError(`${name} expects 1 argument`);
  return fn(args[0]);
}

function normalizeFormula(formula: string): string {
  return formula.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$1").trim();
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ t: "op", v: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lp" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rp" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ t: "comma" });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = input.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) throw new FormulaError("bad number");
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new FormulaError("bad number");
      tokens.push({ t: "num", v: value });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) throw new FormulaError("bad identifier");
      tokens.push({ t: "id", v: match[0] });
      i += match[0].length;
      continue;
    }
    throw new FormulaError(`unexpected '${ch}'`);
  }
  return tokens;
}
