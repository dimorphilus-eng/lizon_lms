/** Сопоставление ответа с шаблоном Moodle: * — любая строка, ? — один символ. Без regexp, чтобы не словить ReDoS. */
export function wildcardMatch(pattern: string, value: string, caseSensitive: boolean): boolean {
  const source = caseSensitive ? pattern : pattern.toLowerCase();
  const target = caseSensitive ? value : value.toLowerCase();
  const memo = new Map<string, boolean>();

  const go = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === source.length) result = j === target.length;
    else if (source[i] === "*") result = go(i + 1, j) || (j < target.length && go(i, j + 1));
    else if (j < target.length && (source[i] === "?" || source[i] === target[j])) result = go(i + 1, j + 1);
    else result = false;
    memo.set(key, result);
    return result;
  };

  return go(0, 0);
}
