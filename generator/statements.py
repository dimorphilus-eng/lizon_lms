"""Пул утверждений. Каждое утверждение сверяется с пересчётом по данным."""

from __future__ import annotations

from generator.evaluate import evaluate
from generator.textutil import cap, ensure_sentence, fmt_num


class Pool:
    def __init__(self, ds: dict):
        self.ds = ds
        self.items: list[dict] = []
        self.texts: set[str] = set()

    def add(
        self,
        *,
        text: str,
        verdict: str,
        error_type: str | None,
        subtype: str,
        difficulty: int,
        predicate: dict,
        explain: str,
        checks: list[str],
    ) -> None:
        text = ensure_sentence(text)
        if text in self.texts or len(text) < 12:
            return
        got = evaluate(self.ds, predicate)
        if verdict == "follows" and got is not True:
            return
        if verdict == "contradicts" and got is not False:
            return
        if verdict == "not_in_data" and got is not None:
            return
        if verdict == "follows" and error_type:
            return
        if verdict != "follows" and not error_type:
            return
        self.texts.add(text)
        self.items.append(
            {
                "text": text,
                "verdict": verdict,
                "error_type": error_type,
                "subtype": subtype,
                "difficulty": difficulty,
                "predicate": predicate,
                "explain": explain,
                "checks": checks,
                "unambiguous": True,
            }
        )


def build_statements(ds: dict) -> list[dict]:
    pool = Pool(ds)
    layout = ds["layout"]
    if layout == "series":
        _series_statements(pool, ds)
    elif layout == "zone":
        _zone_statements(pool, ds)
    elif layout == "matrix":
        _matrix_statements(pool, ds)
    elif layout == "points":
        _points_statements(pool, ds)
    else:
        raise ValueError(layout)
    _externals(pool, ds)
    _design(pool, ds)
    return _trim(pool.items)


def pool_is_rich(items: list[dict]) -> str | None:
    follows = [s for s in items if s["verdict"] == "follows"]
    bad = [s for s in items if s["verdict"] != "follows"]
    types = {s["error_type"] for s in bad}
    if len(follows) < 6:
        return f"мало верных утверждений: {len(follows)}"
    if len(bad) < 6:
        return f"мало неверных утверждений: {len(bad)}"
    if len(types) < 3:
        return f"мало типов ошибок: {sorted(types)}"
    if len(items) < 12:
        return f"короткий пул: {len(items)}"
    return None


_PRIORITY = [
    ("not_in_data", "mechanism"),
    ("not_in_data", "causation"),
    ("not_in_data", "extrapolation"),
    ("contradicts", "monotonic"),
    ("contradicts", "all"),
    ("follows", "monotonic_up"),
    ("follows", "monotonic_down"),
    ("follows", "point"),
    ("contradicts", "point"),
    ("follows", "compare"),
    ("contradicts", "compare"),
    ("follows", "arithmetic"),
    ("contradicts", "arithmetic"),
    ("follows", "max"),
    ("contradicts", "max"),
    ("follows", "zone"),
    ("contradicts", "zone"),
    ("follows", "zone_best"),
    ("contradicts", "zone_best"),
    ("follows", "depend"),
    ("follows", "series"),
    ("contradicts", "series"),
    ("contradicts", "unit"),
    ("follows", "design"),
    ("contradicts", "design"),
    ("follows", "all"),
    ("follows", "identity"),
    ("contradicts", "identity"),
    ("follows", "spread"),
    ("contradicts", "spread"),
    ("follows", "constant"),
]


def _trim(items: list[dict], limit: int = 18) -> list[dict]:
    picked: list[dict] = []
    used: set[int] = set()

    def take(pred, n: int = 1) -> None:
        got = 0
        for i, item in enumerate(items):
            if i in used:
                continue
            if pred(item):
                picked.append(item)
                used.add(i)
                got += 1
                if got >= n or len(picked) >= limit:
                    return

    for verdict, subtype in _PRIORITY:
        if len(picked) >= limit:
            break
        take(lambda s, v=verdict, st=subtype: s["verdict"] == v and s["subtype"] == st, 1)

    def ensure(pred, n: int) -> None:
        have = sum(1 for s in picked if pred(s))
        if have < n and len(picked) < limit:
            take(pred, n - have)

    ensure(lambda s: s["verdict"] != "follows", 6)
    ensure(lambda s: s["verdict"] == "follows", 6)
    if len(picked) < limit:
        take(lambda s: s["verdict"] == "follows" and s["subtype"] in {"point", "zone", "compare"}, 3)
    if len(picked) < limit:
        take(lambda s: s["verdict"] != "follows", 2)
    if len(picked) < limit:
        take(lambda s: True, limit)
    return picked[:limit]


def _at(ds, x, capital=False) -> str:
    value = x if isinstance(x, str) else fmt_num(x)
    text = ds["at_template"].format(x=value)
    return cap(text) if capital else text


def _range(ds, a, b) -> str:
    fa = a if isinstance(a, str) else fmt_num(a)
    fb = b if isinstance(b, str) else fmt_num(b)
    return ds["range_template"].format(a=fa, b=fb)


def _y(ds, s: int) -> str:
    return ds["series"][s]["y_full"]


def _unit(ds) -> str:
    return ds["y_unit"]


def _over(unit: str) -> str:
    """«Больше» для штук и особей, «выше» для концентраций и скоростей."""
    head = unit.split("/")[0].split()[0].rstrip(".").lower()
    if head in {"видов", "особей", "шт", "яиц", "родов", "раз", "типов"}:
        return "больше"
    return "выше"


def _series_statements(pool: Pool, ds: dict) -> None:
    xs = ds["x"]
    numeric = all(not isinstance(x, str) for x in xs)
    for s_idx, series in enumerate(ds["series"]):
        ys = series["y"]
        y_full = series["y_full"]
        # Точки: все узлы, верные и перепутанные с другим узлом.
        for i, (x, y) in enumerate(zip(xs, ys)):
            pool.add(
                text=f"{_at(ds, x, True)} {y_full} составляет {fmt_num(y)} {_unit(ds)}",
                verdict="follows",
                error_type=None,
                subtype="point",
                difficulty=1,
                predicate={"type": "point_eq", "s": s_idx, "x": x, "y": y},
                explain=f"{_at(ds, x, True)} в данных указано {fmt_num(y)} {_unit(ds)}.",
                checks=[f"ряд «{series['name']}», x={fmt_num(x) if not isinstance(x, str) else x}, y={fmt_num(y)}"],
            )
            other = ys[(i + 1) % len(ys)]
            if not _same(other, y):
                pool.add(
                    text=f"{_at(ds, x, True)} {y_full} составляет {fmt_num(other)} {_unit(ds)}",
                    verdict="contradicts",
                    error_type="contradicts_data",
                    subtype="point",
                    difficulty=1,
                    predicate={"type": "point_eq", "s": s_idx, "x": x, "y": other},
                    explain=(
                        f"{_at(ds, x, True)} указано {fmt_num(y)} {_unit(ds)}, "
                        f"а не {fmt_num(other)} {_unit(ds)}."
                    ),
                    checks=[f"ряд «{series['name']}», x={x}, фактическое y={fmt_num(y)}"],
                )
        # Максимум и минимум.
        max_y = max(ys)
        min_y = min(ys)
        max_xs = [x for x, y in zip(xs, ys) if _same(y, max_y)]
        min_xs = [x for x, y in zip(xs, ys) if _same(y, min_y)]
        agree = series.get("agree", "f")
        max_word, min_word = {"f": ("максимальна", "минимальна"), "m": ("максимален", "минимален"), "n": ("максимально", "минимально")}[agree]
        if len(max_xs) == 1:
            pool.add(
                text=f"{cap(y_full)} {max_word} {_at(ds, max_xs[0])}",
                verdict="follows",
                error_type=None,
                subtype="max",
                difficulty=1,
                predicate={"type": "argmax", "s": s_idx, "x": max_xs[0]},
                explain=f"Наибольшее значение в этом ряду — {fmt_num(max_y)} {_unit(ds)}, оно одно и стоит {_at(ds, max_xs[0])}.",
                checks=[f"максимум ряда «{series['name']}»"],
            )
            wrong_x = xs[0] if not _same(xs[0], max_xs[0]) else xs[-1]
            pool.add(
                text=f"{cap(y_full)} {max_word} {_at(ds, wrong_x)}",
                verdict="contradicts",
                error_type="contradicts_data",
                subtype="max",
                difficulty=1,
                predicate={"type": "argmax", "s": s_idx, "x": wrong_x},
                explain=f"Максимум приходится на {_at(ds, max_xs[0])}, а не на {_at(ds, wrong_x)}.",
                checks=[f"максимум ряда «{series['name']}»"],
            )
        if len(min_xs) == 1 and not _same(min_xs[0], max_xs[0] if len(max_xs) == 1 else None):
            pool.add(
                text=f"{cap(y_full)} {min_word} {_at(ds, min_xs[0])}",
                verdict="follows",
                error_type=None,
                subtype="max",
                difficulty=1,
                predicate={"type": "argmin", "s": s_idx, "x": min_xs[0]},
                explain=f"Наименьшее значение — {fmt_num(min_y)} {_unit(ds)} {_at(ds, min_xs[0])}.",
                checks=[f"минимум ряда «{series['name']}»"],
            )
        # Сравнения пар.
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                if _same(ys[i], ys[j]):
                    continue
                left, right = (i, j) if ys[i] > ys[j] else (j, i)
                op_word = "выше"
                pool.add(
                    text=(
                        f"{_at(ds, xs[left], True)} {y_full} выше, чем {_at(ds, xs[right])}"
                    ),
                    verdict="follows",
                    error_type=None,
                    subtype="compare",
                    difficulty=1,
                    predicate={"type": "cmp", "s": s_idx, "x1": xs[left], "x2": xs[right], "op": ">"},
                    explain=(
                        f"{fmt_num(ys[left])} {_unit(ds)} {_at(ds, xs[left])} больше, чем "
                        f"{fmt_num(ys[right])} {_unit(ds)} {_at(ds, xs[right])}."
                    ),
                    checks=[f"сравнение {xs[left]} и {xs[right]}, ряд «{series['name']}»"],
                )
                pool.add(
                    text=(
                        f"{_at(ds, xs[right], True)} {y_full} выше, чем {_at(ds, xs[left])}"
                    ),
                    verdict="contradicts",
                    error_type="contradicts_data",
                    subtype="compare",
                    difficulty=1,
                    predicate={"type": "cmp", "s": s_idx, "x1": xs[right], "x2": xs[left], "op": ">"},
                    explain=(
                        f"На самом деле {_at(ds, xs[left])} значение больше: "
                        f"{fmt_num(ys[left])} против {fmt_num(ys[right])}."
                    ),
                    checks=[f"сравнение {xs[left]} и {xs[right]}"],
                )
                if op_word:
                    break
            if i > 2:
                break
        # Арифметика.
        _arithmetic(pool, ds, s_idx, xs, ys, y_full)
        # Тренд.
        if ds.get("range_template") and len(xs) >= 3:
            _trends(pool, ds, s_idx, xs, ys, y_full, numeric)
        # «При всех» и «не зависит».
        _absolutes(pool, ds, s_idx, ys, y_full)
        if series.get("spread"):
            _spread(pool, ds, s_idx, xs, series)
    if len(ds["series"]) >= 2:
        _two_series(pool, ds)
    if ds.get("wrong_unit"):
        _unit_trap(pool, ds)
    _extrapolation(pool, ds)


def _arithmetic(pool, ds, s_idx, xs, ys, y_full) -> None:
    # Разность двух несоседних точек и среднее.
    pairs = []
    if len(xs) >= 2:
        pairs.append((0, len(xs) // 2))
        pairs.append((0, len(xs) - 1))
        if len(xs) >= 4:
            pairs.append((1, len(xs) - 2))
    seen = set()
    for i, j in pairs:
        if (i, j) in seen:
            continue
        seen.add((i, j))
        if ys[i] == ys[j]:
            continue
        hi, lo = (i, j) if ys[i] > ys[j] else (j, i)
        delta = ys[hi] - ys[lo]
        pool.add(
            text=(
                f"{_at(ds, xs[hi], True)} {y_full} больше, чем {_at(ds, xs[lo])}, "
                f"на {fmt_num(delta)} {_unit(ds)}"
            ),
            verdict="follows",
            error_type=None,
            subtype="arithmetic",
            difficulty=2,
            predicate={"type": "diff", "s": s_idx, "x1": xs[hi], "x2": xs[lo], "delta": delta},
            explain=(
                f"{fmt_num(ys[hi])} − {fmt_num(ys[lo])} = {fmt_num(delta)}."
            ),
            checks=[f"разность {xs[hi]} и {xs[lo]}"],
        )
        step = 1 if isinstance(delta, int) or float(delta).is_integer() else 0.5
        wrong = delta + step * (2 if abs(delta) > 3 else 1)
        pool.add(
            text=(
                f"{_at(ds, xs[hi], True)} {y_full} больше, чем {_at(ds, xs[lo])}, "
                f"на {fmt_num(wrong)} {_unit(ds)}"
            ),
            verdict="contradicts",
            error_type="arithmetic_error",
            subtype="arithmetic",
            difficulty=2,
            predicate={"type": "diff", "s": s_idx, "x1": xs[hi], "x2": xs[lo], "delta": wrong},
            explain=(
                f"Разность равна {fmt_num(delta)} {_unit(ds)}, а не {fmt_num(wrong)} {_unit(ds)}."
            ),
            checks=[f"разность {xs[hi]} и {xs[lo]}"],
        )
        if ys[lo] not in (0, 0.0) and ys[hi] % ys[lo] == 0 if _is_int(ys[hi]) and _is_int(ys[lo]) else False:
            k = int(ys[hi] // ys[lo])
            if 2 <= k <= 6:
                pool.add(
                    text=(
                        f"Отношение значения {y_full} {_at(ds, xs[hi])} "
                        f"к значению {_at(ds, xs[lo])} равно {k}"
                    ),
                    verdict="follows",
                    error_type=None,
                    subtype="arithmetic",
                    difficulty=2,
                    predicate={"type": "ratio", "s": s_idx, "x1": xs[hi], "x2": xs[lo], "k": k},
                    explain=f"{fmt_num(ys[hi])} / {fmt_num(ys[lo])} = {k}.",
                    checks=[f"отношение {xs[hi]} к {xs[lo]}"],
                )
                pool.add(
                    text=(
                        f"Отношение значения {y_full} {_at(ds, xs[hi])} "
                        f"к значению {_at(ds, xs[lo])} равно {k + 1}"
                    ),
                    verdict="contradicts",
                    error_type="arithmetic_error",
                    subtype="arithmetic",
                    difficulty=2,
                    predicate={"type": "ratio", "s": s_idx, "x1": xs[hi], "x2": xs[lo], "k": k + 1},
                    explain=f"Отношение равно {k}, а не {k + 1}.",
                    checks=[f"отношение {xs[hi]} к {xs[lo]}"],
                )
        mean = (ys[i] + ys[j]) / 2
        pool.add(
            text=(
                f"Среднее арифметическое значений {y_full} {_at(ds, xs[i])} "
                f"и {_at(ds, xs[j])} равно {fmt_num(mean)} {_unit(ds)}"
            ),
            verdict="follows",
            error_type=None,
            subtype="arithmetic",
            difficulty=2,
            predicate={"type": "mean", "s": s_idx, "xs": [xs[i], xs[j]], "mean": mean},
            explain=f"({fmt_num(ys[i])} + {fmt_num(ys[j])}) / 2 = {fmt_num(mean)}.",
            checks=[f"среднее {xs[i]} и {xs[j]}"],
        )


def _trends(pool, ds, s_idx, xs, ys, y_full, numeric) -> None:
    up = _longest_strict(xs, ys, "up")
    down = _longest_strict(xs, ys, "down")
    if up:
        _trend_add(pool, ds, s_idx, xs[up[0]], xs[up[1]], y_full, "up", True)
    if down:
        _trend_add(pool, ds, s_idx, xs[down[0]], xs[down[1]], y_full, "down", True)
    # Ложные «непрерывно» на всём ряду.
    for direction, word in (("up", "возрастает"), ("down", "снижается")):
        pred = {"type": "monotonic", "s": s_idx, "x0": xs[0], "x1": xs[-1], "direction": direction}
        # Добавляем только если утверждение ложно: так ловушка честная.
        pool.add(
            text=(
                f"На участке {_range(ds, xs[0], xs[-1])} {y_full} непрерывно {word}"
            ),
            verdict="contradicts",
            error_type="not_monotonic",
            subtype="monotonic",
            difficulty=3,
            predicate=pred,
            explain=_mono_explain(xs, ys, direction),
            checks=[f"монотонность всего ряда «{ds['series'][s_idx]['name']}»"],
        )
    if numeric and max(ys) != min(ys):
        pool.add(
            text=f"На участке {_range(ds, xs[0], xs[-1])} {y_full} изменяется",
            verdict="follows",
            error_type=None,
            subtype="depend",
            difficulty=2,
            predicate={"type": "changes", "s": s_idx, "x0": xs[0], "x1": xs[-1]},
            explain=f"В ряду есть разные значения: от {fmt_num(min(ys))} до {fmt_num(max(ys))} {_unit(ds)}.",
            checks=["изменение на всём ряду"],
        )


def _longest_strict(xs, ys, direction: str):
    best = None
    n = len(xs)
    for i in range(n):
        j = i
        while j + 1 < n:
            step_ok = ys[j + 1] > ys[j] if direction == "up" else ys[j + 1] < ys[j]
            if not step_ok:
                break
            j += 1
        if j >= i + 2 and (best is None or j - i > best[1] - best[0]):
            best = (i, j)
    return best


def _trend_add(pool, ds, s_idx, a, b, y_full, direction, truth) -> None:
    word = "возрастает" if direction == "up" else "снижается"
    pool.add(
        text=f"На участке {_range(ds, a, b)} {y_full} непрерывно {word}",
        verdict="follows" if truth else "contradicts",
        error_type=None if truth else "not_monotonic",
        subtype=f"monotonic_{direction}",
        difficulty=2,
        predicate={"type": "monotonic", "s": s_idx, "x0": a, "x1": b, "direction": direction},
        explain=f"На этом участке каждый следующий узел {'выше' if direction == 'up' else 'ниже'} предыдущего.",
        checks=[f"отрезок {a}–{b}, направление {direction}"],
    )


def _mono_explain(xs, ys, direction: str) -> str:
    for a, b, x0, x1 in zip(ys, ys[1:], xs, xs[1:]):
        if direction == "up" and b <= a:
            return (
                f"Непрерывного роста нет: при переходе от {_fmt_x(x0)} к {_fmt_x(x1)} "
                f"значение меняется с {fmt_num(a)} на {fmt_num(b)}."
            )
        if direction == "down" and b >= a:
            return (
                f"Непрерывного снижения нет: при переходе от {_fmt_x(x0)} к {_fmt_x(x1)} "
                f"значение меняется с {fmt_num(a)} на {fmt_num(b)}."
            )
    return "На этом участке направление другое."


def _absolutes(pool, ds, s_idx, ys, y_full) -> None:
    factor = ds["factor_gen"]
    minimum = min(ys)
    maximum = max(ys)
    if minimum != maximum:
        pool.add(
            text=f"{cap(y_full)} не зависит от {factor}",
            verdict="contradicts",
            error_type="contradicts_data",
            subtype="constant",
            difficulty=2,
            predicate={"type": "constant", "s": s_idx},
            explain=(
                f"Значения не одинаковы: минимум {fmt_num(minimum)}, максимум {fmt_num(maximum)} {_unit(ds)}."
            ),
            checks=["постоянство ряда"],
        )
    # Истинное «выше порога» — порог строго меньше минимума.
    if isinstance(minimum, (int, float)) and minimum >= 1 and float(minimum).is_integer():
        thr = int(minimum) - 1
        pool.add(
            text=f"При всех указанных значениях {factor} {y_full} {_over(_unit(ds))} {fmt_num(thr)} {_unit(ds)}",
            verdict="follows",
            error_type=None,
            subtype="all",
            difficulty=2,
            predicate={"type": "all_cmp", "s": s_idx, "op": ">", "threshold": thr},
            explain=f"Наименьшее значение в ряду — {fmt_num(minimum)} {_unit(ds)}, оно {_over(_unit(ds))} {fmt_num(thr)}.",
            checks=["сравнение всех узлов с порогом"],
        )
    # Ложное «при всех выше» — порог между минимумом и максимумом.
    if maximum > minimum:
        thr_false = minimum
        pool.add(
            text=f"При всех указанных значениях {factor} {y_full} {_over(_unit(ds))} {fmt_num(thr_false)} {_unit(ds)}",
            verdict="contradicts",
            error_type="absolute_claim",
            subtype="all",
            difficulty=3,
            predicate={"type": "all_cmp", "s": s_idx, "op": ">", "threshold": thr_false},
            explain=(
                f"Есть значение {fmt_num(minimum)} {_unit(ds)}, оно не {_over(_unit(ds))} {fmt_num(thr_false)}."
            ),
            checks=["проверка минимума ряда"],
        )


def _spread(pool, ds, s_idx, xs, series) -> None:
    sp = series["spread"]
    best = max(sp)
    hits = [x for x, v in zip(xs, sp) if _same(v, best)]
    if len(hits) != 1:
        return
    y_full = series["y_full"]
    pool.add(
        text=f"Наибольший разброс значений {y_full} отмечен {_at(ds, hits[0])}",
        verdict="follows",
        error_type=None,
        subtype="spread",
        difficulty=2,
        predicate={"type": "spread_argmax", "s": s_idx, "x": hits[0]},
        explain=(
            f"В столбце разброса максимум {fmt_num(best)} {_unit(ds)} стоит {_at(ds, hits[0])}. "
            "Разброс в таблице — это уже посчитанная разность максимума и минимума повторов."
        ),
        checks=[f"столбец разброса, x={hits[0]}"],
    )
    wrong = xs[0] if not _same(xs[0], hits[0]) else xs[-1]
    pool.add(
        text=f"Наибольший разброс значений {y_full} отмечен {_at(ds, wrong)}",
        verdict="contradicts",
        error_type="contradicts_data",
        subtype="spread",
        difficulty=2,
        predicate={"type": "spread_argmax", "s": s_idx, "x": wrong},
        explain=f"Наибольший разброс — {_at(ds, hits[0])} ({fmt_num(best)} {_unit(ds)}).",
        checks=["столбец разброса"],
    )


def _two_series(pool, ds) -> None:
    xs = ds["x"]
    a, b = ds["series"][0], ds["series"][1]
    # Поузловое сравнение и «всегда выше».
    greater = []
    for x, ya, yb in zip(xs, a["y"], b["y"]):
        if ya == yb:
            continue
        s_hi, s_lo, y_hi, y_lo = (0, 1, ya, yb) if ya > yb else (1, 0, yb, ya)
        greater.append(s_hi)
        pool.add(
            text=f"{_at(ds, x, True)} {ds['series'][s_hi]['y_full']} выше, чем {ds['series'][s_lo]['y_full']}",
            verdict="follows",
            error_type=None,
            subtype="series",
            difficulty=2,
            predicate={"type": "series_cmp", "s1": s_hi, "s2": s_lo, "x": x, "op": ">"},
            explain=f"{_at(ds, x, True)} {fmt_num(y_hi)} > {fmt_num(y_lo)} {_unit(ds)}.",
            checks=[f"два ряда при x={x}"],
        )
    if greater and all(g == 0 for g in greater) and len(greater) == len(xs):
        pool.add(
            text=f"При всех указанных значениях {ds['factor_gen']} {a['y_full']} выше, чем {b['y_full']}",
            verdict="follows",
            error_type=None,
            subtype="series",
            difficulty=2,
            predicate={"type": "all_series_cmp", "s1": 0, "s2": 1, "op": ">"},
            explain="В каждом узле первый ряд больше второго.",
            checks=["все узлы, сравнение рядов"],
        )
    elif greater and all(g == 1 for g in greater) and len(greater) == len(xs):
        pool.add(
            text=f"При всех указанных значениях {ds['factor_gen']} {b['y_full']} выше, чем {a['y_full']}",
            verdict="follows",
            error_type=None,
            subtype="series",
            difficulty=2,
            predicate={"type": "all_series_cmp", "s1": 1, "s2": 0, "op": ">"},
            explain="В каждом узле второй ряд больше первого.",
            checks=["все узлы, сравнение рядов"],
        )
    else:
        pool.add(
            text=f"При всех указанных значениях {ds['factor_gen']} {a['y_full']} выше, чем {b['y_full']}",
            verdict="contradicts",
            error_type="absolute_claim",
            subtype="series",
            difficulty=3,
            predicate={"type": "all_series_cmp", "s1": 0, "s2": 1, "op": ">"},
            explain="Нет превышения первого ряда над вторым в каждом узле.",
            checks=["все узлы, сравнение рядов"],
        )
    # Перепутать ряды в одной точке.
    x = xs[len(xs) // 2]
    ya, yb = a["y"][len(xs) // 2], b["y"][len(xs) // 2]
    if ya != yb:
        pool.add(
            text=f"{_at(ds, x, True)} {a['y_full']} составляет {fmt_num(yb)} {_unit(ds)}",
            verdict="contradicts",
            error_type="legend_or_units",
            subtype="unit",
            difficulty=2,
            predicate={"type": "point_eq", "s": 0, "x": x, "y": yb},
            explain=(
                f"Значение {fmt_num(yb)} {_unit(ds)} относится к ряду «{b['name']}», "
                f"а у ряда «{a['name']}» здесь {fmt_num(ya)} {_unit(ds)}."
            ),
            checks=[f"легенда, x={x}"],
        )


def _unit_trap(pool, ds) -> None:
    series = ds["series"][0]
    # Точка не крайняя, чтобы не путать с максимумом «на глаз».
    i = min(2, len(ds["x"]) - 1)
    x, y = ds["x"][i], series["y"][i]
    wrong = ds["wrong_unit"]
    if wrong == ds["y_unit"]:
        return
    pool.add(
        text=f"{_at(ds, x, True)} {series['y_full']} составляет {fmt_num(y)} {wrong}",
        verdict="contradicts",
        error_type="legend_or_units",
        subtype="unit",
        difficulty=2,
        predicate={"type": "point_eq", "s": 0, "x": x, "y": y, "unit": wrong},
        explain=f"Число {fmt_num(y)} в этой точке верное, но единица измерения — {ds['y_unit']}, а не {wrong}.",
        checks=["единица измерения оси или столбца"],
    )


def _extrapolation(pool, ds) -> None:
    outside = ds.get("outside_x")
    if outside is None:
        return
    series = ds["series"][0]
    # Число нарочно похоже на соседнее, но узла на оси нет.
    fake = series["y"][0]
    pool.add(
        text=f"{_at(ds, outside, True)} {series['y_full']} составляет {fmt_num(fake)} {_unit(ds)}",
        verdict="not_in_data",
        error_type="extrapolation",
        subtype="extrapolation",
        difficulty=3,
        predicate={"type": "external", "kind": "extrapolation"},
        explain=(
            f"Значения { _fmt_x(outside) } на оси нет. Продолжать ряд за пределы данных нельзя."
        ),
        checks=["граница оси"],
    )


def _zone_statements(pool: Pool, ds: dict) -> None:
    zone = ds["zone"]
    points = ds["clear_points"]
    value = zone["value_name"]
    unit = zone["value_unit"]
    # Верные и неверные точки разных уровней.
    by_level: dict = {}
    for p in points:
        by_level.setdefault(p["level"], []).append(p)
    legend_levels = sorted(z["level"] for z in zone["zones"]) + [zone["outside"]]
    outside = zone["outside"]
    for level in sorted(by_level, reverse=True):
        pts = by_level[level]
        limit = 1 if level == outside else 2
        for p in pts[:limit]:
            phrase = _z_at(ds, p["x"], p["y"], True)
            pool.add(
                text=f"{phrase} {value} составляет {fmt_num(level)} {unit}",
                verdict="follows",
                error_type=None,
                subtype="zone",
                difficulty=2,
                predicate={"type": "zone_eq", "x": p["x"], "y": p["y"], "level": level},
                explain=(
                    f"Точка ({fmt_num(p['x'])}; {fmt_num(p['y'])}) однозначно лежит в области "
                    f"{fmt_num(level)} {unit} и не на границе соседней зоны."
                ),
                checks=[f"зона, x={p['x']}, y={p['y']}, уровень {level}"],
            )
            wrong_levels = [lv for lv in legend_levels if lv != level]
            if wrong_levels:
                wrong = wrong_levels[0] if wrong_levels[0] != level else wrong_levels[-1]
                pool.add(
                    text=f"{phrase} {value} составляет {fmt_num(wrong)} {unit}",
                    verdict="contradicts",
                    error_type="legend_or_units",
                    subtype="zone",
                    difficulty=2,
                    predicate={"type": "zone_eq", "x": p["x"], "y": p["y"], "level": wrong},
                    explain=(
                        f"В этой точке уровень {fmt_num(level)} {unit}, а не {fmt_num(wrong)} {unit}."
                    ),
                    checks=[f"зона, x={p['x']}, y={p['y']}"],
                )
    max_level = max(z["level"] for z in zone["zones"])
    best_pts = by_level.get(max_level, [])
    other_pts = [p for p in points if p["level"] != max_level]
    if best_pts:
        p = best_pts[0]
        pool.add(
            text=(
                f"Наиболее благоприятные из показанных условий — {_z_at(ds, p['x'], p['y'])}: "
                f"здесь {value} достигает наибольшего отмеченного уровня"
            ),
            verdict="follows",
            error_type=None,
            subtype="zone_best",
            difficulty=3,
            predicate={"type": "zone_best", "x": p["x"], "y": p["y"]},
            explain=(
                f"Точка лежит в зоне максимального уровня {fmt_num(max_level)} {unit}. "
                "Утверждение не говорит, что благоприятна только эта одна точка."
            ),
            checks=[f"максимальная зона, x={p['x']}, y={p['y']}"],
        )
    if other_pts:
        p = other_pts[0]
        pool.add(
            text=(
                f"Наиболее благоприятные из показанных условий — {_z_at(ds, p['x'], p['y'])}: "
                f"здесь {value} достигает наибольшего отмеченного уровня"
            ),
            verdict="contradicts",
            error_type="contradicts_data",
            subtype="zone_best",
            difficulty=3,
            predicate={"type": "zone_best", "x": p["x"], "y": p["y"]},
            explain=(
                f"В этой точке уровень {fmt_num(p['level'])} {unit}, "
                f"а наибольший уровень на графике — {fmt_num(max_level)} {unit}."
            ),
            checks=[f"не максимальная зона, x={p['x']}, y={p['y']}"],
        )
    # Зависимость от горизонтального фактора при фиксированной вертикали и в полосе.
    y_ticks = zone["y_ticks"]
    for y in y_ticks:
        pool.add(
            text=ds["depend_one"].format(y=fmt_num(y), value=value),
            verdict="follows",
            error_type=None,
            subtype="depend",
            difficulty=3,
            predicate={"type": "zone_varies_y", "y": y},
            explain=(
                f"На горизонтали {fmt_num(y)} есть однозначные точки с разными уровнями, "
                "значит показатель меняется вдоль второй оси."
            ),
            checks=[f"горизонталь y={y}"],
        )
    if len(y_ticks) >= 3:
        y0, y1 = y_ticks[1], y_ticks[-2]
        pool.add(
            text=ds["depend_band"].format(a=fmt_num(y0), b=fmt_num(y1), value=value),
            verdict="follows",
            error_type=None,
            subtype="depend",
            difficulty=3,
            predicate={"type": "zone_varies_band", "y0": y0, "y1": y1},
            explain="В этой полосе есть точки разных уровней при разной координате по горизонтальной оси.",
            checks=[f"полоса {y0}–{y1}"],
        )
    pool.add(
        text=ds["absolute_text"],
        verdict="contradicts",
        error_type="absolute_claim",
        subtype="all",
        difficulty=3,
        predicate={"type": "zone_all_above", "threshold": 0},
        explain="Вне контуров значение равно 0, поэтому утверждение «при любых сочетаниях выше нуля» неверно.",
        checks=["вся плоскость графика, внешняя область"],
    )
    if ds.get("high_x_template"):
        thr = zone["x_ticks"][-2]
        text = ds["high_x_template"].format(thr=fmt_num(thr), level=fmt_num(max_level), value=value)
        pool.add(
            text=text,
            verdict="contradicts",
            error_type="absolute_claim",
            subtype="all",
            difficulty=3,
            predicate={"type": "zone_region_eq", "x_min": thr, "level": max_level},
            explain=(
                f"Правее отметки {fmt_num(thr)} на шкале есть участки вне зоны "
                f"{fmt_num(max_level)} {unit}, в том числе фон со значением 0."
            ),
            checks=[f"горизонтальная ось выше {thr}"],
        )
    if ds.get("region_claim"):
        claim = ds["region_claim"]
        pool.add(
            text=claim["text"],
            verdict="contradicts",
            error_type="absolute_claim",
            subtype="all",
            difficulty=3,
            predicate=claim["predicate"],
            explain=claim["explain"],
            checks=["край шкалы, где зона максимума не проходит"],
        )
    # Сравнение двух ясных точек.
    if len(points) >= 2:
        p1, p2 = points[0], points[-1]
        if p1["level"] != p2["level"]:
            hi, lo = (p1, p2) if p1["level"] > p2["level"] else (p2, p1)
            pool.add(
                text=(
                    f"{_z_at(ds, hi['x'], hi['y'], True)} {value} выше, чем {_z_at(ds, lo['x'], lo['y'])}"
                ),
                verdict="follows",
                error_type=None,
                subtype="compare",
                difficulty=2,
                predicate={
                    "type": "zone_cmp",
                    "x1": hi["x"],
                    "y1": hi["y"],
                    "x2": lo["x"],
                    "y2": lo["y"],
                    "op": ">",
                },
                explain=(
                    f"Уровни {fmt_num(hi['level'])} и {fmt_num(lo['level'])} {unit}."
                ),
                checks=["две зоны"],
            )
            # Отдельный предикат сравнения уровней нужен, чтобы ложное сравнение не прошло
            # из-за того, что zone_eq первой точки истинен. Ниже — прямое ложное равенство.
            pool.add(
                text=f"{_z_at(ds, hi['x'], hi['y'], True)} {value} составляет {fmt_num(lo['level'])} {unit}",
                verdict="contradicts",
                error_type="contradicts_data",
                subtype="zone",
                difficulty=2,
                predicate={"type": "zone_eq", "x": hi["x"], "y": hi["y"], "level": lo["level"]},
                explain=f"Здесь уровень {fmt_num(hi['level'])} {unit}, а не {fmt_num(lo['level'])} {unit}.",
                checks=["перенос уровня чужой точки"],
            )


def _matrix_statements(pool: Pool, ds: dict) -> None:
    matrix = ds["matrix"]
    cols = {c["key"]: c for c in matrix["columns"]}
    for row in matrix["rows"]:
        for col in matrix["columns"]:
            value = row["values"][col["key"]]
            phrase = f"{cap(col['at'])} {row['nom']} составляет {fmt_num(value)} {row['unit']}"
            pool.add(
                text=phrase,
                verdict="follows",
                error_type=None,
                subtype="point",
                difficulty=1,
                predicate={"type": "cell_eq", "row": row["key"], "col": col["key"], "value": value},
                explain=f"В ячейке «{row['label']} / {col['label']}» стоит {fmt_num(value)} {row['unit']}.",
                checks=[f"ячейка {row['key']}/{col['key']}"],
            )
        # Ложная ячейка: подставить значение из другого столбца той же строки.
        if len(matrix["columns"]) >= 2:
            c0, c1 = matrix["columns"][0], matrix["columns"][1]
            v0, v1 = row["values"][c0["key"]], row["values"][c1["key"]]
            if not _same(v0, v1):
                pool.add(
                    text=f"{cap(c0['at'])} {row['nom']} составляет {fmt_num(v1)} {row['unit']}",
                    verdict="contradicts",
                    error_type="contradicts_data",
                    subtype="point",
                    difficulty=1,
                    predicate={"type": "cell_eq", "row": row["key"], "col": c0["key"], "value": v1},
                    explain=(
                        f"В столбце «{c0['label']}» стоит {fmt_num(v0)} {row['unit']}, "
                        f"а {fmt_num(v1)} — в столбце «{c1['label']}»."
                    ),
                    checks=[f"строка {row['key']}"],
                )
                op = ">" if v0 > v1 else "<"
                word = "выше" if v0 > v1 else "ниже"
                pool.add(
                    text=f"{cap(c0['at'])} {row['nom']} {word}, чем {c1['at']}",
                    verdict="follows",
                    error_type=None,
                    subtype="compare",
                    difficulty=1,
                    predicate={"type": "cell_cmp", "row": row["key"], "col1": c0["key"], "col2": c1["key"], "op": op},
                    explain=f"{fmt_num(v0)} {word}, чем {fmt_num(v1)}.",
                    checks=[f"сравнение столбцов в строке {row['key']}"],
                )
                pool.add(
                    text=f"{cap(c0['at'])} {row['nom']} {'ниже' if word == 'выше' else 'выше'}, чем {c1['at']}",
                    verdict="contradicts",
                    error_type="contradicts_data",
                    subtype="compare",
                    difficulty=1,
                    predicate={
                        "type": "cell_cmp",
                        "row": row["key"],
                        "col1": c0["key"],
                        "col2": c1["key"],
                        "op": "<" if op == ">" else ">",
                    },
                    explain=f"Соотношение обратное: {fmt_num(v0)} и {fmt_num(v1)}.",
                    checks=[f"сравнение столбцов в строке {row['key']}"],
                )
    # Сравнение строк в одном столбце.
    if len(matrix["rows"]) >= 2 and matrix["columns"]:
        col = matrix["columns"][0]
        r0, r1 = matrix["rows"][0], matrix["rows"][1]
        v0, v1 = r0["values"][col["key"]], r1["values"][col["key"]]
        if v0 != v1 and r0["unit"] == r1["unit"]:
            hi, lo = (r0, r1) if v0 > v1 else (r1, r0)
            pool.add(
                text=f"{cap(col['at'])} {hi['nom']} выше, чем {lo['nom']}",
                verdict="follows",
                error_type=None,
                subtype="compare",
                difficulty=1,
                predicate={"type": "row_cmp", "row1": hi["key"], "row2": lo["key"], "col": col["key"], "op": ">"},
                explain=f"{fmt_num(hi['values'][col['key']])} > {fmt_num(lo['values'][col['key']])} {hi['unit']}.",
                checks=[f"столбец {col['key']}, строки {hi['key']} и {lo['key']}"],
            )
    for ident in matrix.get("identities", []):
        pool.add(
            text=ident["text_true"],
            verdict="follows",
            error_type=None,
            subtype="identity",
            difficulty=2,
            predicate={
                "type": "identity",
                "terms": ident["terms"],
                "total": ident["total"],
                "op": ident.get("op", "sum"),
            },
            explain=ident["explain_true"],
            checks=["арифметическая связь ячеек"],
        )
        pool.add(
            text=ident["text_false"],
            verdict="contradicts",
            error_type="arithmetic_error",
            subtype="identity",
            difficulty=2,
            predicate={
                "type": "identity",
                "terms": ident["false_terms"],
                "total": ident["total"],
                "op": ident.get("false_op", ident.get("op", "sum")),
            },
            explain=ident["explain_false"],
            checks=["арифметическая связь ячеек"],
        )
    if matrix.get("absolute_text"):
        # Ложное «во всех ячейках».
        pool.add(
            text=matrix["absolute_text"],
            verdict="contradicts",
            error_type="absolute_claim",
            subtype="all",
            difficulty=3,
            predicate=matrix["absolute_predicate"],
            explain=matrix["absolute_explain"],
            checks=["все указанные ячейки"],
        )


def _points_statements(pool: Pool, ds: dict) -> None:
    y_full = ds["y_full"]
    x_full = ds["x_full"]
    for rec in ds["points"]:
        name = rec["name"]
        pool.add(
            text=f"У объекта «{name}» {y_full} составляет {fmt_num(rec['y'])} {ds['y_unit']}",
            verdict="follows",
            error_type=None,
            subtype="point",
            difficulty=1,
            predicate={"type": "point_named_y", "name": name, "y": rec["y"]},
            explain=f"Точка «{name}» имеет вертикальную координату {fmt_num(rec['y'])} {ds['y_unit']}.",
            checks=[f"точка {name}, y"],
        )
        pool.add(
            text=f"У объекта «{name}» {x_full} составляет {fmt_num(rec['x'])} {ds['x_unit']}",
            verdict="follows",
            error_type=None,
            subtype="point",
            difficulty=1,
            predicate={"type": "point_named_x", "name": name, "x": rec["x"]},
            explain=f"Точка «{name}» имеет горизонтальную координату {fmt_num(rec['x'])} {ds['x_unit']}.",
            checks=[f"точка {name}, x"],
        )
    # Перепутать y двух точек.
    if len(ds["points"]) >= 2:
        a, b = ds["points"][0], ds["points"][1]
        if a["y"] != b["y"]:
            pool.add(
                text=f"У объекта «{a['name']}» {y_full} составляет {fmt_num(b['y'])} {ds['y_unit']}",
                verdict="contradicts",
                error_type="contradicts_data",
                subtype="point",
                difficulty=1,
                predicate={"type": "point_named_y", "name": a["name"], "y": b["y"]},
                explain=f"У «{a['name']}» указано {fmt_num(a['y'])}, а {fmt_num(b['y'])} — у «{b['name']}».",
                checks=["подписи точек"],
            )
            hi, lo = (a, b) if a["y"] > b["y"] else (b, a)
            pool.add(
                text=f"У объекта «{hi['name']}» {y_full} выше, чем у объекта «{lo['name']}»",
                verdict="follows",
                error_type=None,
                subtype="compare",
                difficulty=1,
                predicate={"type": "named_cmp_y", "n1": hi["name"], "n2": lo["name"], "op": ">"},
                explain=f"{fmt_num(hi['y'])} > {fmt_num(lo['y'])} {ds['y_unit']}.",
                checks=["сравнение двух подписанных точек"],
            )
            pool.add(
                text=f"У объекта «{lo['name']}» {y_full} выше, чем у объекта «{hi['name']}»",
                verdict="contradicts",
                error_type="contradicts_data",
                subtype="compare",
                difficulty=1,
                predicate={"type": "named_cmp_y", "n1": lo["name"], "n2": hi["name"], "op": ">"},
                explain=f"Выше значение у «{hi['name']}»: {fmt_num(hi['y'])} против {fmt_num(lo['y'])}.",
                checks=["сравнение двух подписанных точек"],
            )
        delta = _clean_delta(a["y"], b["y"])
        if delta is not None and delta != 0:
            hi, lo = (a, b) if a["y"] > b["y"] else (b, a)
            delta = abs(delta)
            wrong = delta + (2 if float(delta).is_integer() else 0.5)
            pool.add(
                text=(
                    f"У объекта «{hi['name']}» {y_full} больше, чем у объекта «{lo['name']}», "
                    f"на {fmt_num(delta)} {ds['y_unit']}"
                ),
                verdict="follows",
                error_type=None,
                subtype="arithmetic",
                difficulty=2,
                predicate={"type": "named_diff", "n1": hi["name"], "n2": lo["name"], "delta": delta},
                explain=f"{fmt_num(hi['y'])} − {fmt_num(lo['y'])} = {fmt_num(delta)}.",
                checks=["разность двух точек"],
            )
            pool.add(
                text=(
                    f"У объекта «{hi['name']}» {y_full} больше, чем у объекта «{lo['name']}», "
                    f"на {fmt_num(wrong)} {ds['y_unit']}"
                ),
                verdict="contradicts",
                error_type="arithmetic_error",
                subtype="arithmetic",
                difficulty=2,
                predicate={"type": "named_diff", "n1": hi["name"], "n2": lo["name"], "delta": wrong},
                explain=f"Разность равна {fmt_num(delta)} {ds['y_unit']}, а не {fmt_num(wrong)}.",
                checks=["разность двух точек"],
            )
    ys = [p["y"] for p in ds["points"]]
    if ys.count(max(ys)) == 1:
        winner = max(ds["points"], key=lambda p: p["y"])
        pool.add(
            text=f"Наибольшее значение {y_full} — у объекта «{winner['name']}»",
            verdict="follows",
            error_type=None,
            subtype="max",
            difficulty=1,
            predicate={"type": "named_is_max", "name": winner["name"]},
            explain=f"Это {fmt_num(winner['y'])} {ds['y_unit']}, больше остальных подписанных точек.",
            checks=["максимум среди точек"],
        )
        other = next(p for p in ds["points"] if p["name"] != winner["name"])
        pool.add(
            text=f"Наибольшее значение {y_full} — у объекта «{other['name']}»",
            verdict="contradicts",
            error_type="contradicts_data",
            subtype="max",
            difficulty=1,
            predicate={"type": "named_is_max", "name": other["name"]},
            explain=f"У «{other['name']}» {fmt_num(other['y'])}, у «{winner['name']}» {fmt_num(winner['y'])}.",
            checks=["максимум среди точек"],
        )


def _externals(pool: Pool, ds: dict) -> None:
    for item in ds.get("externals", []):
        pool.add(
            text=item["text"],
            verdict="not_in_data",
            error_type=item["error_type"],
            subtype=item.get("subtype") or ("mechanism" if item["error_type"] == "not_in_data" else item["error_type"]),
            difficulty=3,
            predicate={"type": "external", "kind": item["error_type"]},
            explain=item["explain"],
            checks=["в данных нет измерения, которое подтвердило бы эту формулировку"],
        )


def _design(pool: Pool, ds: dict) -> None:
    if ds.get("design") == "experiment" and ds.get("n_factors", 1) == 1 and ds.get("iv") and ds.get("factor_acc"):
        pool.add(
            text=f"Независимая переменная в этом опыте — {ds['iv']}",
            verdict="follows",
            error_type=None,
            subtype="design",
            difficulty=2,
            predicate={"type": "iv_eq", "value": ds["iv"]},
            explain=f"В подписи к данным сказано, что изменяли {ds['factor_acc']}.",
            checks=["подпись об условиях опыта"],
        )
        pool.add(
            text=f"Независимая переменная в этом опыте — {ds['dv']}",
            verdict="contradicts",
            error_type="contradicts_data",
            subtype="design",
            difficulty=2,
            predicate={"type": "iv_eq", "value": ds["dv"]},
            explain=f"Независимая переменная — {ds['iv']}. {cap(ds['dv'])} в этом опыте измеряли.",
            checks=["подпись об условиях опыта"],
        )
        pool.add(
            text=f"В опыте изменяли только {ds['factor_acc']}, остальные условия сохраняли одинаковыми",
            verdict="follows",
            error_type=None,
            subtype="design",
            difficulty=2,
            predicate={"type": "design_claim", "claim": "single"},
            explain="Это прямо сказано в подписи к данным.",
            checks=["подпись об условиях опыта"],
        )
        pool.add(
            text="В опыте одновременно меняли несколько факторов, поэтому связать результат с одним фактором нельзя",
            verdict="contradicts",
            error_type="contradicts_data",
            subtype="design",
            difficulty=3,
            predicate={"type": "design_claim", "claim": "multi"},
            explain="В подписи указано, что меняли только один фактор, а остальные условия были одинаковыми.",
            checks=["подпись об условиях опыта"],
        )
    if ds.get("sum_slices"):
        total = sum(y for s in ds["series"] for y in s["y"])
        pool.add(
            text=f"Сумма всех приведённых долей равна {fmt_num(total)} %",
            verdict="follows",
            error_type=None,
            subtype="arithmetic",
            difficulty=2,
            predicate={"type": "sum_slices", "value": total},
            explain=f"Сумма долей: {fmt_num(total)} %.",
            checks=["сумма секторов"],
        )


def _z_at(ds, x, y, capital=False) -> str:
    text = ds["zone_at"].format(x=fmt_num(x), y=fmt_num(y))
    return cap(text) if capital else text


def _same(a, b) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) < 1e-6


def _is_int(v) -> bool:
    return isinstance(v, int) or (isinstance(v, float) and float(v).is_integer())


def _clean_delta(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return None
    if isinstance(a, bool) or isinstance(b, bool):
        return None
    delta = float(a) - float(b)
    if isinstance(a, int) and isinstance(b, int):
        return float(a - b)
    rounded = round(delta, 2)
    if abs(rounded - delta) > 1e-8:
        return None
    return rounded


def _fmt_x(x) -> str:
    return x if isinstance(x, str) else fmt_num(x)
