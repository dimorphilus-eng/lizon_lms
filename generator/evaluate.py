"""Пересчёт вердикта утверждения по числам набора данных."""

from __future__ import annotations

from generator.curves import index_of, same_num, y_at


def evaluate(data: dict, pred: dict):
    """True — следует, False — противоречит, None — из данных не следует."""
    kind = pred["type"]
    if kind == "external":
        return None
    if kind == "point_eq":
        actual = _series_y(data, pred["s"], pred["x"])
        if "unit" in pred and pred["unit"] != data.get("y_unit"):
            return False
        return same_num(actual, pred["y"])
    if kind == "cmp":
        a = _series_y(data, pred["s"], pred["x1"])
        b = _series_y(data, pred["s"], pred["x2"])
        return _op(a, b, pred["op"])
    if kind == "series_cmp":
        a = _series_y(data, pred["s1"], pred["x"])
        b = _series_y(data, pred["s2"], pred["x"])
        return _op(a, b, pred["op"])
    if kind == "argmax":
        xs = data["x"]
        ys = data["series"][pred["s"]]["y"]
        best = max(ys)
        hits = [xs[i] for i, y in enumerate(ys) if same_num(y, best)]
        return len(hits) == 1 and _eq_x(hits[0], pred["x"])
    if kind == "argmin":
        xs = data["x"]
        ys = data["series"][pred["s"]]["y"]
        best = min(ys)
        hits = [xs[i] for i, y in enumerate(ys) if same_num(y, best)]
        return len(hits) == 1 and _eq_x(hits[0], pred["x"])
    if kind == "monotonic":
        ys = _slice(data, pred["s"], pred["x0"], pred["x1"])
        if pred["direction"] == "up":
            return all(b > a for a, b in zip(ys, ys[1:]))
        if pred["direction"] == "down":
            return all(b < a for a, b in zip(ys, ys[1:]))
        raise ValueError(pred["direction"])
    if kind == "changes":
        ys = _slice(data, pred["s"], pred["x0"], pred["x1"])
        return max(ys) != min(ys)
    if kind == "constant":
        ys = data["series"][pred["s"]]["y"]
        return max(ys) == min(ys)
    if kind == "all_cmp":
        ys = data["series"][pred["s"]]["y"]
        return all(_op(y, pred["threshold"], pred["op"]) for y in ys)
    if kind == "all_series_cmp":
        xs = data["x"]
        ok = []
        for x in xs:
            a = _series_y(data, pred["s1"], x)
            b = _series_y(data, pred["s2"], x)
            ok.append(_op(a, b, pred["op"]))
        return all(ok)
    if kind == "diff":
        a = _series_y(data, pred["s"], pred["x1"])
        b = _series_y(data, pred["s"], pred["x2"])
        return same_num(a - b, pred["delta"])
    if kind == "ratio":
        a = _series_y(data, pred["s"], pred["x1"])
        b = _series_y(data, pred["s"], pred["x2"])
        if b == 0:
            return False
        return same_num(a / b, pred["k"])
    if kind == "mean":
        vals = [_series_y(data, pred["s"], x) for x in pred["xs"]]
        return same_num(sum(vals) / len(vals), pred["mean"])
    if kind == "spread_argmax":
        xs = data["x"]
        sp = data["series"][pred["s"]]["spread"]
        best = max(sp)
        hits = [xs[i] for i, y in enumerate(sp) if same_num(y, best)]
        return len(hits) == 1 and _eq_x(hits[0], pred["x"])
    if kind == "design_claim":
        is_exp = data.get("design") == "experiment"
        if pred["claim"] == "single":
            return is_exp
        if pred["claim"] == "multi":
            return not is_exp
        raise ValueError(pred["claim"])
    if kind == "iv_eq":
        return data.get("iv") == pred["value"]
    if kind == "zone_eq":
        return _zone_level(data, pred["x"], pred["y"]) == pred["level"]
    if kind == "zone_best":
        level = _zone_level(data, pred["x"], pred["y"])
        return level == max(z["level"] for z in data["zone"]["zones"])
    if kind == "zone_varies_y":
        levels = [p["level"] for p in data["clear_points"] if _eq_x(p["y"], pred["y"])]
        return len(levels) >= 2 and len(set(levels)) >= 2
    if kind == "zone_varies_band":
        lo, hi = pred["y0"], pred["y1"]
        pts = [p for p in data["clear_points"] if lo - 1e-9 <= float(p["y"]) <= hi + 1e-9]
        xs = {p["x"] for p in pts}
        levels = {p["level"] for p in pts}
        return len(pts) >= 3 and len(xs) >= 2 and len(levels) >= 2
    if kind == "zone_all_above":
        return all(level > pred["threshold"] for level in _dense_levels(data))
    if kind == "zone_region_eq":
        # Все точки плотной сетки с x > x_min (или y > y_min) имеют один уровень.
        levels = []
        for x, y, level in _dense_levels_xy(data):
            if "x_min" in pred and not (x > pred["x_min"]):
                continue
            if "y_min" in pred and not (y > pred["y_min"]):
                continue
            levels.append(level)
        if len(levels) < 5:
            return False
        return all(level == pred["level"] for level in levels)
    if kind == "cell_eq":
        return same_num(_cell(data, pred["row"], pred["col"]), pred["value"])
    if kind == "cell_cmp":
        a = _cell(data, pred["row"], pred["col1"])
        b = _cell(data, pred["row"], pred["col2"])
        return _op(a, b, pred["op"])
    if kind == "row_cmp":
        a = _cell(data, pred["row1"], pred["col"])
        b = _cell(data, pred["row2"], pred["col"])
        return _op(a, b, pred["op"])
    if kind == "identity":
        terms = [_cell(data, r, c) for r, c in pred["terms"]]
        total = _cell(data, pred["total"][0], pred["total"][1])
        if pred.get("op", "sum") == "sum":
            return same_num(sum(terms), total)
        if pred["op"] == "diff":
            return same_num(terms[0] - terms[1], total)
        if pred["op"] == "mul1000":
            return same_num(terms[0] * terms[1] / 1000, total)
        raise ValueError(pred.get("op"))
    if kind == "point_named_y":
        rec = _named(data, pred["name"])
        return same_num(rec["y"], pred["y"])
    if kind == "point_named_x":
        rec = _named(data, pred["name"])
        return same_num(rec["x"], pred["x"])
    if kind == "named_cmp_y":
        a = _named(data, pred["n1"])["y"]
        b = _named(data, pred["n2"])["y"]
        return _op(a, b, pred["op"])
    if kind == "named_is_max":
        ys = [(rec["name"], rec["y"]) for rec in data["points"]]
        best = max(y for _, y in ys)
        hits = [name for name, y in ys if same_num(y, best)]
        return hits == [pred["name"]]
    if kind == "named_diff":
        a = _named(data, pred["n1"])["y"]
        b = _named(data, pred["n2"])["y"]
        return same_num(a - b, pred["delta"])
    if kind == "zone_cmp":
        a = _zone_level(data, pred["x1"], pred["y1"])
        b = _zone_level(data, pred["x2"], pred["y2"])
        return _op(a, b, pred["op"])
    if kind == "sum_slices":
        total = sum(y for s in data["series"] for y in s["y"])
        return same_num(total, pred["value"])
    raise ValueError(f"unknown predicate {kind}")


def _op(a, b, op: str) -> bool:
    if op == ">":
        return a > b
    if op == "<":
        return a < b
    if op == ">=":
        return a >= b
    if op == "<=":
        return a <= b
    if op == "==":
        return same_num(a, b)
    raise ValueError(op)


def _eq_x(a, b) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    return same_num(a, b)


def _series_y(data, s, x):
    return y_at(data["x"], data["series"][s]["y"], x)


def _slice(data, s, x0, x1):
    xs = data["x"]
    ys = data["series"][s]["y"]
    i0, i1 = index_of(xs, x0), index_of(xs, x1)
    if i1 < i0:
        i0, i1 = i1, i0
    if i1 == i0:
        raise ValueError("empty slice")
    return ys[i0 : i1 + 1]


def _zone_level(data, x, y) -> float:
    best = None
    for zone in data["zone"]["zones"]:
        rx, ry = zone["rx"], zone["ry"]
        r2 = ((x - zone["cx"]) / rx) ** 2 + ((y - zone["cy"]) / ry) ** 2
        if r2 <= 1.0:
            if best is None or zone["level"] > best:
                best = zone["level"]
    if best is None:
        return data["zone"]["outside"]
    return best


def _dense_levels_xy(data):
    zone = data["zone"]
    x0, x1 = zone["x_lim"]
    y0, y1 = zone["y_lim"]
    x = x0
    while x <= x1 + 1e-9:
        y = y0
        while y <= y1 + 1e-9:
            yield x, y, _zone_level(data, x, y)
            y += 1
        x += 1


def _dense_levels(data):
    return [level for _, _, level in _dense_levels_xy(data)]


def _cell(data, row, col):
    for item in data["matrix"]["rows"]:
        if item["key"] == row:
            return item["values"][col]
    raise KeyError(row)


def _named(data, name):
    for rec in data["points"]:
        if rec["name"] == name:
            return rec
    raise KeyError(name)
