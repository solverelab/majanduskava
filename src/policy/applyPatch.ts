/* @solvere/core — applyPatch.ts
 * Reference implementation: applyPatch v1
 * - Path: dot segments + [index]
 * - No implicit creation (fail-fast)
 * - All-or-nothing (throws on first error, never mutates input)
 * - Sequential operations
 * - Structural sharing (copies only touched branches)
 */

import type { ActionV1, PatchOperation } from "./solvereCoreV1";

export type PatchErrorCode =
  | "PATCH_INVALID_PATH_SYNTAX"
  | "PATCH_EMPTY_PATH"
  | "PATCH_NOT_AN_OBJECT"
  | "PATCH_NOT_AN_ARRAY"
  | "PATCH_KEY_NOT_FOUND"
  | "PATCH_INDEX_OOB"
  | "PATCH_TYPE_MISMATCH"
  | "PATCH_NON_NUMERIC_TARGET"
  | "PATCH_NON_NUMERIC_VALUE"
  | "PATCH_UNSUPPORTED_VALUE";

export class PatchError extends Error {
  public readonly code: PatchErrorCode;
  public readonly opIndex: number;
  public readonly path: string;

  constructor(args: {
    code: PatchErrorCode;
    opIndex: number;
    path: string;
    message: string;
  }) {
    super(args.message);
    this.name = "PatchError";
    this.code = args.code;
    this.opIndex = args.opIndex;
    this.path = args.path;
  }
}

// -------- Path parsing --------

type PathToken =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number };

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parsePath(path: string, opIndex = -1): PathToken[] {
  if (!path || !path.trim()) {
    throw new PatchError({
      code: "PATCH_EMPTY_PATH",
      opIndex,
      path,
      message: "Patch path is empty.",
    });
  }

  const tokens: PathToken[] = [];
  let i = 0;

  const fail = (msg: string) => {
    throw new PatchError({
      code: "PATCH_INVALID_PATH_SYNTAX",
      opIndex,
      path,
      message: msg,
    });
  };

  const readKey = (): string => {
    let start = i;
    while (i < path.length) {
      const ch = path[i];
      if (ch === "." || ch === "[" || ch === "]") break;
      i++;
    }
    const key = path.slice(start, i);
    if (!KEY_RE.test(key)) fail(`Invalid key segment "${key}" in path.`);
    return key;
  };

  const readIndex = (): number => {
    if (path[i] !== "[") fail("Expected '['.");
    i++; // skip '['
    let start = i;
    while (i < path.length && path[i] >= "0" && path[i] <= "9") i++;
    if (start === i) fail("Empty array index '[]' is not allowed.");
    if (path[i] !== "]") fail("Missing closing ']' for array index.");
    const raw = path.slice(start, i);
    i++; // skip ']'
    const idx = Number(raw);
    if (!Number.isInteger(idx) || idx < 0) fail(`Invalid array index "${raw}".`);
    return idx;
  };

  if (path[i] === "." || path[i] === "[" || path[i] === "]") {
    fail("Path must start with a key segment.");
  }

  tokens.push({ kind: "key", key: readKey() });

  while (i < path.length) {
    const ch = path[i];

    if (ch === "[") {
      tokens.push({ kind: "index", index: readIndex() });
      continue;
    }

    if (ch === ".") {
      i++;
      if (i >= path.length) fail("Trailing '.' is not allowed.");
      tokens.push({ kind: "key", key: readKey() });
      continue;
    }

    fail(`Unexpected character "${ch}" in path.`);
  }

  return tokens;
}

// -------- Utilities --------

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cloneContainer(v: unknown): any {
  if (Array.isArray(v)) return v.slice();
  if (isObjectLike(v)) return { ...v };
  return v;
}

function assertPrimitiveValue(
  value: unknown,
  opIndex: number,
  path: string
): asserts value is number | string | boolean {
  const t = typeof value;
  if (t !== "number" && t !== "string" && t !== "boolean") {
    throw new PatchError({
      code: "PATCH_UNSUPPORTED_VALUE",
      opIndex,
      path,
      message: `Unsupported patch value type "${t}". Only number|string|boolean are allowed.`,
    });
  }
}

function getAtTokens(
  root: any,
  tokens: PathToken[],
  opIndex: number,
  path: string
): unknown {
  let cur: any = root;
  for (const tok of tokens) {
    if (tok.kind === "key") {
      if (!isObjectLike(cur)) {
        throw new PatchError({
          code: "PATCH_NOT_AN_OBJECT",
          opIndex,
          path,
          message: `Expected object while traversing "${tok.key}".`,
        });
      }
      if (!(tok.key in cur)) {
        throw new PatchError({
          code: "PATCH_KEY_NOT_FOUND",
          opIndex,
          path,
          message: `Key "${tok.key}" not found.`,
        });
      }
      cur = cur[tok.key];
    } else {
      if (!Array.isArray(cur)) {
        throw new PatchError({
          code: "PATCH_NOT_AN_ARRAY",
          opIndex,
          path,
          message: `Expected array while traversing index [${tok.index}].`,
        });
      }
      if (tok.index < 0 || tok.index >= cur.length) {
        throw new PatchError({
          code: "PATCH_INDEX_OOB",
          opIndex,
          path,
          message: `Index [${tok.index}] out of bounds (len=${cur.length}).`,
        });
      }
      cur = cur[tok.index];
    }
  }
  return cur;
}

/**
 * Immutable set: clones only along the touched path (structural sharing).
 * Requires the full path to exist (no implicit creation).
 */
function setAtTokensImmutable(
  root: any,
  tokens: PathToken[],
  newValue: unknown,
  opIndex: number,
  path: string
): any {
  const rootClone = cloneContainer(root);
  let curOrig: any = root;
  let curNew: any = rootClone;

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    const isLast = t === tokens.length - 1;

    if (tok.kind === "key") {
      if (!isObjectLike(curOrig)) {
        throw new PatchError({
          code: "PATCH_NOT_AN_OBJECT",
          opIndex,
          path,
          message: `Expected object while traversing "${tok.key}".`,
        });
      }
      if (!(tok.key in curOrig)) {
        throw new PatchError({
          code: "PATCH_KEY_NOT_FOUND",
          opIndex,
          path,
          message: `Key "${tok.key}" not found.`,
        });
      }

      if (isLast) {
        if (!isObjectLike(curNew)) {
          throw new PatchError({
            code: "PATCH_NOT_AN_OBJECT",
            opIndex,
            path,
            message: `Expected object at assignment for key "${tok.key}".`,
          });
        }
        curNew[tok.key] = newValue;
      } else {
        const nextOrig = curOrig[tok.key];
        const nextClone = cloneContainer(nextOrig);

        if (!isObjectLike(curNew)) {
          throw new PatchError({
            code: "PATCH_NOT_AN_OBJECT",
            opIndex,
            path,
            message: `Expected object while preparing path "${tok.key}".`,
          });
        }
        curNew[tok.key] = nextClone;

        curOrig = nextOrig;
        curNew = nextClone;
      }
    } else {
      if (!Array.isArray(curOrig)) {
        throw new PatchError({
          code: "PATCH_NOT_AN_ARRAY",
          opIndex,
          path,
          message: `Expected array while traversing index [${tok.index}].`,
        });
      }
      if (tok.index < 0 || tok.index >= curOrig.length) {
        throw new PatchError({
          code: "PATCH_INDEX_OOB",
          opIndex,
          path,
          message: `Index [${tok.index}] out of bounds (len=${curOrig.length}).`,
        });
      }

      if (!Array.isArray(curNew)) {
        throw new PatchError({
          code: "PATCH_NOT_AN_ARRAY",
          opIndex,
          path,
          message: `Expected array at assignment/traversal for [${tok.index}].`,
        });
      }

      if (isLast) {
        curNew[tok.index] = newValue;
      } else {
        const nextOrig = curOrig[tok.index];
        const nextClone = cloneContainer(nextOrig);
        curNew[tok.index] = nextClone;

        curOrig = nextOrig;
        curNew = nextClone;
      }
    }
  }

  return rootClone;
}

// -------- applyPatch (v1) --------

export function applyPatch<State>(state: State, patch: PatchOperation[]): State {
  let next: any = state;

  for (let opIndex = 0; opIndex < patch.length; opIndex++) {
    const op = patch[opIndex];

    assertPrimitiveValue(op.value, opIndex, op.path);

    const tokens = parsePath(op.path, opIndex);

    if (op.op === "set") {
      next = setAtTokensImmutable(next, tokens, op.value, opIndex, op.path);
      continue;
    }

    if (typeof op.value !== "number" || Number.isNaN(op.value)) {
      throw new PatchError({
        code: "PATCH_NON_NUMERIC_VALUE",
        opIndex,
        path: op.path,
        message: `${op.op} requires numeric "value".`,
      });
    }

    const current = getAtTokens(next, tokens, opIndex, op.path);
    if (typeof current !== "number" || Number.isNaN(current)) {
      throw new PatchError({
        code: "PATCH_NON_NUMERIC_TARGET",
        opIndex,
        path: op.path,
        message: `${op.op} requires numeric target at path.`,
      });
    }

    const updated =
      op.op === "increment" ? current + op.value : current - op.value;

    next = setAtTokensImmutable(next, tokens, updated, opIndex, op.path);
  }

  return next as State;
}

export function applyAction<State>(state: State, action: ActionV1): State {
  if (action.kind !== "patch") {
    throw new Error(`Unsupported action kind "${(action as any).kind}".`);
  }
  return applyPatch(state, action.patch);
}
