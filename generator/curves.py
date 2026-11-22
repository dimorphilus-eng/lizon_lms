"""Детерминированные школьные кривые и биологические проверки чисел."""

from __future__ import annotations


class CurveError(ValueError):
    pass


def nonincreasing_gaps(total: int, n: int, strength: int = 1) -> list[int] | None:
    """Положительные невозрастающие шаги, сумма равна total.

    Чем больше strength, тем круче первые шаги и тем положе хвост.
    """
    if n <= 0 or total < n:
        return None
    strength = max(1, int(strength))
    ratio = 1.2 + 0.55 * (strength - 1)
    weights = [ratio ** (n - 1 - i) for i in range(n)]
    rem = total - n
    sw = sum(weights)
    raw = [rem * w / sw for w in weights]
    extras = [int(v) for v in raw]
    left = rem - sum(extras)
    order = sorted(range(n), key=lambda i: (raw[i] - extras[i], -i), reverse=True)
    for k in range(left):
        extras[order[k]] += 1
    gaps = [1 + e for e in extras]
    gaps.sort(reverse=True)
    if sum(gaps) != total or min(gaps) < 1:
        return None
    if any(a < b for a, b in zip(gaps, gaps[1:])):
        return None
    return gaps


def _phase_shift(gaps: list[int], phase: int, increasing: bool) -> list[int]:
    """Слегка переносит единицу между соседними шагами, не ломая монотонность шагов."""
    gaps = list(gaps)
    moves = phase % max(1, len(gaps))
    for _ in range(moves):
        changed = False
        pairs = range(len(gaps) - 1) if not increasing else range(len(gaps) - 1)
        for i in pairs:
            if increasing:
                # Шаги растут к концу: gaps[i] <= gaps[i+1].
                if gaps[i + 1] > gaps[i] + 1:
                    gaps[i + 1] -= 1
                    gaps[i] += 1
                    changed = True
                    break
            else:
                if gaps[i] > gaps[i + 1] + 1:
                    gaps[i] -= 1
                    gaps[i + 1] += 1
                    changed = True
                    break
        if not changed:
            break
    return gaps


def accelerating_gaps(total: int, n: int) -> list[int] | None:
    gaps = nonincreasing_gaps(total, n)
    if gaps is None:
        return None
    return list(reversed(gaps))


def unimodal(
    xs: list,
    opt,
    left: int,
    peak: int,
    right: int,
    phase: int = 0,
    rise_strength: int = 2,
    fall_strength: int = 4,
) -> list[int]:
    if opt not in xs:
        raise CurveError(f"optimum {opt} not on grid {xs}")
    i_opt = xs.index(opt)
    n_left = i_opt
    n_right = len(xs) - i_opt - 1
    if peak <= left or peak <= right:
        raise CurveError("peak must exceed both ends")
    rise = peak - int(left)
    fall = peak - int(right)
    if n_left and rise < n_left:
        raise CurveError("rise too small")
    if n_right and fall < n_right:
        raise CurveError("fall too small")
    ys = [0] * len(xs)
    ys[i_opt] = int(peak)
    if n_left:
        gaps = nonincreasing_gaps(rise, n_left, strength=rise_strength)
        if gaps is None:
            raise CurveError("rise gaps")
        # К оптимуму шаг крупнее: развернуть (медленный старт, быстрый подъём).
        gaps = list(reversed(gaps))
        gaps = _phase_shift(gaps, phase, increasing=True)
        ys[0] = int(left)
        for i, g in enumerate(gaps):
            ys[i + 1] = ys[i] + g
        if ys[i_opt] != peak:
            raise CurveError("rise did not hit peak")
    if n_right:
        gaps = nonincreasing_gaps(fall, n_right, strength=fall_strength)
        if gaps is None:
            raise CurveError("fall gaps")
        gaps = _phase_shift(gaps, phase, increasing=False)
        # Сразу после оптимума спад круче.
        for i, g in enumerate(gaps):
            ys[i_opt + 1 + i] = ys[i_opt + i] - g
        if ys[-1] != int(right):
            raise CurveError("fall did not hit right")
    if max(ys) != peak or ys.count(peak) != 1:
        raise CurveError("peak not unique")
    if n_left and any(ys[i] >= ys[i + 1] for i in range(i_opt)):
        raise CurveError("left not strict")
    if n_right and any(ys[i] <= ys[i + 1] for i in range(i_opt, len(xs) - 1)):
        raise CurveError("right not strict")
    if any(y < 0 for y in ys):
        raise CurveError("negative")
    return ys


def saturate(xs: list, y0: int, ymax: int, strength: int = 2) -> list[int]:
    n = len(xs) - 1
    total = int(ymax) - int(y0)
    gaps = nonincreasing_gaps(total, n, strength=strength)
    if gaps is None:
        raise CurveError("saturation gaps")
    ys = [int(y0)]
    for g in gaps:
        ys.append(ys[-1] + g)
    if ys[-1] != int(ymax) or any(b <= a for a, b in zip(ys, ys[1:])):
        raise CurveError("saturation shape")
    return ys


def decline(xs: list, y0: int, y1: int, strength: int = 2) -> list[int]:
    n = len(xs) - 1
    total = int(y0) - int(y1)
    gaps = nonincreasing_gaps(total, n, strength=strength)
    if gaps is None:
        raise CurveError("decline gaps")
    ys = [int(y0)]
    for g in gaps:
        ys.append(ys[-1] - g)
    if ys[-1] != int(y1) or any(b >= a for a, b in zip(ys, ys[1:])):
        raise CurveError("decline shape")
    return ys


def grow(xs: list, y0: int, y1: int) -> list[int]:
    """Строгий рост с неубывающими приростами (разгон, без выхода на плато)."""
    n = len(xs) - 1
    total = int(y1) - int(y0)
    gaps = accelerating_gaps(total, n)
    if gaps is None:
        raise CurveError("grow gaps")
    ys = [int(y0)]
    for g in gaps:
        ys.append(ys[-1] + g)
    if ys[-1] != int(y1):
        raise CurveError("grow end")
    return ys


def same_num(a, b) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    return abs(float(a) - float(b)) < 1e-6


def argmax_x(xs, ys):
    m = max(ys)
    hits = [xs[i] for i, y in enumerate(ys) if same_num(y, m)]
    if len(hits) != 1:
        return None
    return hits[0]


def y_at(xs, ys, x):
    for xi, yi in zip(xs, ys):
        if isinstance(x, str) or isinstance(xi, str):
            if str(xi) == str(x):
                return yi
        elif same_num(xi, x):
            return yi
    raise KeyError(x)


def strict_up(ys, i0, i1) -> bool:
    seg = ys[i0 : i1 + 1]
    return len(seg) >= 2 and all(b > a for a, b in zip(seg, seg[1:]))


def strict_down(ys, i0, i1) -> bool:
    seg = ys[i0 : i1 + 1]
    return len(seg) >= 2 and all(b < a for a, b in zip(seg, seg[1:]))


def index_of(xs, x) -> int:
    for i, xi in enumerate(xs):
        if isinstance(x, str) or isinstance(xi, str):
            if str(xi) == str(x):
                return i
        elif same_num(xi, x):
            return i
    raise KeyError(x)


def check_series(check: str, xs, series: list[dict], ctx: dict) -> str | None:
    """Вернуть текст ошибки или None, если числа допустимы."""
    if not check:
        return None
    ys0 = series[0]["y"]
    if any(not isinstance(y, (int, float)) for s in series for y in s["y"]):
        return "non-numeric y"
    if check == "nonneg":
        if any(y < 0 for s in series for y in s["y"]):
            return "negative"
        return None
    if check == "percent_0_100":
        if any(y < 0 or y > 100 for s in series for y in s["y"]):
            return "percent out of range"
        return None
    if check == "human_enzyme_temp":
        return _enzyme_temp(xs, series, 35, 42, hot=60, hot_frac=0.25)
    if check == "plant_enzyme_temp":
        return _enzyme_temp(xs, series, 20, 35, hot=50, hot_frac=0.45)
    if check == "yeast_enzyme_temp":
        return _enzyme_temp(xs, series, 30, 45, hot=65, hot_frac=0.3)
    if check == "pepsin_ph":
        return _opt_in(xs, ys0, {1, 1.5, 2, 2.5})
    if check == "trypsin_ph":
        return _opt_in(xs, ys0, {7.5, 8, 8.5, 9})
    if check == "amylase_ph":
        return _opt_in(xs, ys0, {6.5, 6.8, 7, 7.2, 7.5})
    if check == "lipase_ph":
        return _opt_in(xs, ys0, {7, 7.5, 8, 8.5})
    if check == "photo_light":
        return _saturating(ys0)
    if check == "photo_temp":
        return _enzyme_temp(xs, series, 20, 30, hot=40, hot_frac=0.5)
    if check == "action_spectrum":
        return _spectrum(xs, ys0)
    if check == "osmosis":
        return _osmosis(ys0)
    if check == "hr":
        if any(y < 40 or y > 200 for s in series for y in s["y"]):
            return "hr range"
        return None
    if check == "daphnia_hr":
        if any(y < 60 or y > 420 for s in series for y in s["y"]):
            return "daphnia hr"
        return None
    if check == "breath_rate":
        if any(y < 4 or y > 80 for s in series for y in s["y"]):
            return "breath"
        return None
    if check == "fish_vent":
        if any(y < 20 or y > 180 for s in series for y in s["y"]):
            return "fish vent"
        return None
    if check == "glucose":
        if any(y < 3 or y > 12 for y in ys0):
            return "glucose range"
        return None
    if check == "survival":
        if any(y < 0 or y > 100 for s in series for y in s["y"]):
            return "survival"
        return None
    if check == "prey_pred":
        return _prey(series)
    if check == "melanism":
        return _melanism(series)
    if check == "s_curve":
        return _s_curve(ys0)
    if check == "bp":
        return None
    if check == "sum100":
        if abs(sum(ys0) - 100) > 1e-6:
            return "sum not 100"
        if any(y <= 0 for y in ys0):
            return "nonpositive share"
        return None
    return f"unknown check {check}"


def _opt_in(xs, ys, allowed) -> str | None:
    opt = argmax_x(xs, ys)
    if opt is None:
        return "no unique optimum"
    if not any(same_num(opt, a) for a in allowed):
        return f"optimum {opt} not in {sorted(allowed, key=lambda z: float(z))}"
    if any(y < 0 for y in ys):
        return "negative"
    return None


def _enzyme_temp(xs, series, lo, hi, hot, hot_frac) -> str | None:
    for s in series:
        ys = s["y"]
        opt = argmax_x(xs, ys)
        if opt is None:
            return "no unique temp optimum"
        if not (lo <= float(opt) <= hi):
            return f"temp optimum {opt} outside {lo}..{hi}"
        peak = max(ys)
        if any(y < 0 for y in ys):
            return "negative rate"
        for x, y in zip(xs, ys):
            fx = float(x)
            if fx >= 70 and y > peak * 0.15:
                return f"too active at {x}"
            if fx >= hot and y > peak * hot_frac:
                return f"too active at {x}"
        if ys[xs.index(opt)] != peak:
            return "peak mismatch"
    return None


def _saturating(ys) -> str | None:
    if any(b <= a for a, b in zip(ys, ys[1:])):
        return "not strict increase"
    deltas = [b - a for a, b in zip(ys, ys[1:])]
    if any(deltas[i] < deltas[i + 1] for i in range(len(deltas) - 1)):
        return "deltas increase"
    if deltas[0] < deltas[-1]:
        return "no saturation shape"
    return None


def _spectrum(xs, ys) -> str | None:
    labels = [str(x).lower() for x in xs]
    def val(part):
        for lab, y in zip(labels, ys):
            if part in lab:
                return y
        return None
    green = val("зелён")
    if green is None:
        green = val("зелен")
    blue = val("синий")
    red = val("красный (6")
    if red is None:
        red = val("красный")
    far = val("дальн")
    if None in (green, blue, red):
        return "spectrum labels"
    if not (blue > green * 1.8 and red > green * 1.8):
        return "blue/red not above green"
    if far is not None and far > green:
        return "far-red too high"
    if max(ys) > 100 or min(ys) < 0:
        return "spectrum scale"
    return None


def _osmosis(ys) -> str | None:
    if any(b >= a for a, b in zip(ys, ys[1:])):
        return "osmosis not decreasing"
    if not (ys[0] > 0 and ys[-1] < 0):
        return "osmosis should change sign"
    return None


def _prey(series) -> str | None:
    if len(series) != 2:
        return "need prey and predator"
    prey, pred = series[0]["y"], series[1]["y"]
    if any(p <= q for p, q in zip(prey, pred)):
        return "predator not below prey"
    if any(q <= 0 or p <= 0 for p, q in zip(prey, pred)):
        return "nonpositive counts"
    if max(pred) * 4 > max(prey):
        return "predator too numerous"
    return None


def _melanism(series) -> str | None:
    if len(series) != 2:
        return "two morphs"
    a, b = series[0]["y"], series[1]["y"]
    for u, v in zip(a, b):
        if abs((u + v) - 100) > 1e-6:
            return "morphs must sum to 100"
        if u < 0 or v < 0:
            return "negative share"
    return None


def _s_curve(ys) -> str | None:
    if any(b <= a for a, b in zip(ys, ys[1:])):
        return "s-curve not strict"
    deltas = [b - a for a, b in zip(ys, ys[1:])]
    if max(deltas) == deltas[0] or max(deltas) == deltas[-1]:
        return "s-curve peak increment at edge"
    return None
