"""Сборка набора данных из краткого описания сюжета."""

from __future__ import annotations

from generator.codifier import BLOCKS, ELEMENTS, SOURCE_NOTE
from generator.curves import (
    CurveError,
    check_series,
    decline,
    grow,
    saturate,
    unimodal,
)

# Точка годится для утверждения, только если она заметно внутри своей зоны
# и заметно снаружи более высокой. Доля 0,82 / 1,18 оставляет зазор до границы.
INSIDE_R = 0.82
OUTSIDE_R = 1.18


class Reject(Exception):
    pass


def materialize(ctx: dict) -> dict:
    layout = ctx["layout"]
    ds = {
        "block": ctx["block"],
        "block_title": BLOCKS[ctx["block"]],
        "code": ctx["code"],
        "codifier_section": ELEMENTS[ctx["code"]],
        "topic": ctx["topic"],
        "subtopic": ctx["subtopic"],
        "form": ctx["form"],
        "layout": layout,
        "title": ctx["title"],
        "source_kind": ctx.get("source_kind", "conditional"),
        "source_note": SOURCE_NOTE[ctx.get("source_kind", "conditional")],
        "design": ctx.get("design", "experiment"),
        "conditions": ctx["conditions"],
        "iv": ctx.get("iv", ""),
        "dv": ctx.get("dv", ""),
        "factor_gen": ctx.get("factor_gen", "фактора"),
        "factor_acc": ctx.get("factor_acc", ""),
        "object": ctx.get("object", ""),
        "at_template": ctx.get("at_template", "при значении {x}"),
        "range_template": ctx.get("range_template"),
        "y_name": ctx.get("y_name", ""),
        "y_unit": ctx.get("y_unit", ""),
        "y_full": ctx.get("y_full", ctx.get("y_name", "")),
        "x_full": ctx.get("x_full", ""),
        "x_name": ctx.get("x_name", ""),
        "x_unit": ctx.get("x_unit", ""),
        "wrong_unit": ctx.get("wrong_unit"),
        "outside_x": ctx.get("outside_x"),
        "externals": ctx.get("externals", []),
        "sum_slices": ctx.get("sum_slices", False),
        "family": ctx.get("family", ""),
        "n_factors": ctx.get("n_factors", 1),
        "high_x_template": ctx.get("high_x_template"),
    }
    if layout == "series":
        _fill_series(ds, ctx)
    elif layout == "zone":
        _fill_zone(ds, ctx)
    elif layout == "matrix":
        ds["matrix"] = ctx["matrix"]
        ds["x"] = []
        ds["series"] = []
    elif layout == "points":
        ds["points"] = ctx["points"]
        ds["x"] = []
        ds["series"] = []
        if len(ds["points"]) < 5:
            raise Reject("в точечной диаграмме меньше 5 точек")
        if len({p["name"] for p in ds["points"]}) != len(ds["points"]):
            raise Reject("повторяются подписи точек")
    else:
        raise Reject(f"неизвестная форма данных {layout}")
    _claims(ds)
    _demo_guard(ds)
    return ds


def _fill_series(ds: dict, ctx: dict) -> None:
    xs = list(ctx["x"])
    if len(xs) < 4 or len(xs) > 8:
        raise Reject(f"длина ряда {len(xs)} вне 4–8")
    built = []
    for spec in ctx["series"]:
        ys = _y_values(xs, spec)
        item = {
            "name": spec["name"],
            "y_full": spec.get("y_full", ds["y_full"]),
            "agree": spec.get("agree", "f"),
            "y": ys,
        }
        if spec.get("spread") is not None:
            item["spread"] = list(spec["spread"])
            if len(item["spread"]) != len(ys):
                raise Reject("длина разброса не совпала с рядом")
        built.append(item)
        err = None
        if spec.get("check"):
            err = check_series(spec["check"], xs, [item], ctx)
        if err:
            raise Reject(err)
    if ctx.get("check"):
        err = check_series(ctx["check"], xs, built, ctx)
        if err:
            raise Reject(err)
    if any(y < 0 for s in built for y in s["y"]) and not ctx.get("allow_negative"):
        raise Reject("отрицательные значения")
    ds["x"] = xs
    ds["series"] = built
    if ds["outside_x"] is None and all(not isinstance(x, str) for x in xs):
        nums = sorted(float(x) for x in xs)
        step = min(b - a for a, b in zip(nums, nums[1:]))
        ds["outside_x"] = _nice(nums[-1] + 2 * step)
    if ds["form"] == "pie":
        ds["sum_slices"] = True
        if abs(sum(built[0]["y"]) - 100) > 1e-6:
            raise Reject("секторы не дают 100 %")


def _y_values(xs, spec) -> list:
    if spec.get("y") is not None:
        ys = list(spec["y"])
        if len(ys) != len(xs):
            raise Reject("явный ряд не совпал с осью")
        return ys
    shape = spec["shape"]
    try:
        if shape == "unimodal":
            return unimodal(
                xs,
                spec["opt"],
                int(spec["left"]),
                int(spec["peak"]),
                int(spec["right"]),
                phase=int(spec.get("phase", 0)),
                rise_strength=int(spec.get("rise_strength", 2)),
                fall_strength=int(spec.get("fall_strength", 4)),
            )
        if shape == "saturate":
            return saturate(xs, int(spec["y0"]), int(spec["ymax"]), int(spec.get("strength", 2)))
        if shape == "decline":
            return decline(xs, int(spec["y0"]), int(spec["y1"]), int(spec.get("strength", 2)))
        if shape == "grow":
            return grow(xs, int(spec["y0"]), int(spec["y1"]))
    except CurveError as exc:
        raise Reject(str(exc)) from exc
    raise Reject(f"неизвестная форма кривой {shape}")


def _fill_zone(ds: dict, ctx: dict) -> None:
    zone = ctx["zone"]
    if not (3 <= len(zone["zones"]) <= 4):
        raise Reject("нужно 3 или 4 вложенные зоны")
    levels = [z["level"] for z in zone["zones"]]
    if levels != sorted(levels) or len(set(levels)) != len(levels):
        raise Reject("уровни зон должны расти от внешней к внутренней")
    if zone.get("outside", 0) >= levels[0]:
        raise Reject("фон не ниже внешней зоны")
    outer = zone["zones"][0]
    x0, x1 = zone["x_lim"]
    y0, y1 = zone["y_lim"]
    if outer["cx"] - outer["rx"] < x0 - 1e-6 or outer["cx"] + outer["rx"] > x1 + 1e-6:
        raise Reject("внешняя зона выходит за горизонтальную ось")
    if outer["cy"] - outer["ry"] < y0 - 1e-6 or outer["cy"] + outer["ry"] > y1 + 1e-6:
        raise Reject("внешняя зона выходит за вертикальную ось")
    if not _nested(zone):
        raise Reject("зоны не вложены")
    clear = _clear_points(zone)
    if len(clear) < 8:
        raise Reject(f"мало однозначных точек: {len(clear)}")
    needed = set(levels) | {zone.get("outside", 0)}
    counts = {}
    for p in clear:
        counts[p["level"]] = counts.get(p["level"], 0) + 1
    missing = [lv for lv in needed if counts.get(lv, 0) < 2]
    if missing:
        raise Reject(f"меньше двух однозначных точек на уровнях {missing}")
    ds["zone"] = {
        "x_label": zone["x_label"],
        "y_label": zone["y_label"],
        "x_lim": list(zone["x_lim"]),
        "y_lim": list(zone["y_lim"]),
        "x_ticks": list(zone["x_ticks"]),
        "y_ticks": list(zone["y_ticks"]),
        "zones": [dict(z) for z in zone["zones"]],
        "outside": zone.get("outside", 0),
        "value_name": zone["value_name"],
        "value_unit": zone["value_unit"],
        "legend_title": zone["legend_title"],
    }
    ds["clear_points"] = clear
    ds["zone_at"] = ctx["zone_at"]
    ds["depend_one"] = ctx["depend_one"]
    ds["depend_band"] = ctx["depend_band"]
    ds["absolute_text"] = ctx["absolute_text"]
    ds["region_claim"] = ctx.get("region_claim")
    ds["x"] = []
    ds["series"] = []
    # Проверить, что шаблон зависимости хотя бы на одной горизонтали истинен.
    from generator.evaluate import evaluate

    ok = False
    for y in zone["y_ticks"]:
        if evaluate(ds, {"type": "zone_varies_y", "y": y}) is True:
            ok = True
            break
    if not ok:
        raise Reject("ни на одной горизонтали уровень не меняется однозначно")


def _inside(zone, x, y) -> float:
    return ((x - zone["cx"]) / zone["rx"]) ** 2 + ((y - zone["cy"]) / zone["ry"]) ** 2


def _level(zone_spec, x, y):
    best = None
    for zone in zone_spec["zones"]:
        if _inside(zone, x, y) <= 1:
            if best is None or zone["level"] > best:
                best = zone["level"]
    return zone_spec.get("outside", 0) if best is None else best


def _nested(zone_spec) -> bool:
    x0, x1 = zone_spec["x_lim"]
    y0, y1 = zone_spec["y_lim"]
    x = x0
    while x <= x1:
        y = y0
        while y <= y1:
            containing = [z for z in zone_spec["zones"] if _inside(z, x, y) <= 1]
            if containing:
                mx = max(z["level"] for z in containing)
                for z in zone_spec["zones"]:
                    if z["level"] < mx and _inside(z, x, y) > 1:
                        return False
            y += 2
        x += 2
    return True


def _clear_points(zone_spec) -> list[dict]:
    points = []
    for x in zone_spec["x_ticks"]:
        for y in zone_spec["y_ticks"]:
            radii = [(z, _inside(z, x, y) ** 0.5) for z in zone_spec["zones"]]
            containing = [z for z, r in radii if r <= 1]
            if not containing:
                if all(r >= OUTSIDE_R for _, r in radii):
                    points.append({"x": x, "y": y, "level": zone_spec.get("outside", 0)})
                continue
            level = max(z["level"] for z in containing)
            own = [r for z, r in radii if z["level"] == level][0]
            higher = [r for z, r in radii if z["level"] > level]
            if own <= INSIDE_R and all(r >= OUTSIDE_R for r in higher):
                points.append({"x": x, "y": y, "level": level})
    return points


def _claims(ds: dict) -> None:
    if ds["layout"] == "zone":
        ds["can_claim"] = [
            "Считывать уровень только в узлах сетки, которые лежат внутри зоны, а не на границе.",
            "Сравнивать уровни двух таких точек.",
            "Видеть, что вдоль одной горизонтали уровень меняется.",
            "Проверять, попадает ли точка в зону наибольшего уровня.",
        ]
        ds["cannot_claim"] = [
            "Называть физиологическую причину оптимума: её в опыте не измеряли.",
            "Распространять максимальный уровень на весь край шкалы.",
            "Считать, что организм выдерживает любые сочетания факторов, если вне контуров стоит 0.",
        ]
    elif ds["layout"] == "matrix":
        ds["can_claim"] = [
            "Считывать ячейки и сравнивать их.",
            "Проверять арифметическую связь, которая прямо складывается из ячеек.",
        ]
        ds["cannot_claim"] = [
            "Ставить диагноз или называть механизм, если в таблице только числа.",
            "Приписывать ячейке число из соседнего столбца.",
        ]
    else:
        ds["can_claim"] = [
            "Считывать значение в узле ряда и сравнивать два узла.",
            "Находить единственный максимум или минимум.",
            "Проверять, каждый ли шаг на отрезке идёт в одну сторону.",
            "Считать разность, отношение или среднее по явно данным числам.",
        ]
        ds["cannot_claim"] = [
            "Объяснять ход кривой механизмом, который в опыте не измеряли.",
            "Продолжать ряд за последнюю точку оси.",
            "Говорить «при всех» или «непрерывно», не проверив каждый узел.",
        ]
    if ds["design"] == "observation":
        ds["cannot_claim"].append("Считать совпадение двух рядов доказательством, что один процесс — причина другого.")


def _demo_guard(ds: dict) -> None:
    blob = ds["title"].lower()
    if "коконопряд" in blob or "соснов" in blob and "влажн" in blob:
        raise Reject("сюжет демоверсии")


def _nice(value: float):
    if abs(value - round(value)) < 1e-6:
        return int(round(value))
    return round(value, 2)
