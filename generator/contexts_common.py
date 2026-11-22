"""Общие заготовки сюжетов линии 21."""

from __future__ import annotations


def ext(text: str, error_type: str, explain: str) -> dict:
    return {"text": text, "error_type": error_type, "explain": explain}


def mechanism(text: str, explain: str) -> dict:
    return ext(text, "not_in_data", explain)


def cause(text: str, explain: str) -> dict:
    return ext(text, "causation", explain)


def xy(**kwargs) -> dict:
    kwargs.setdefault("layout", "series")
    kwargs.setdefault("source_kind", "pattern")
    kwargs.setdefault("design", "experiment")
    kwargs.setdefault("n_factors", 1)
    kwargs.setdefault("wrong_unit", "мг/л")
    return kwargs


def zone_ellipses(cx, cy, rx, ry) -> list[dict]:
    """Три вложенных эллипса: 20, 50 и 80. Внешний — первый."""
    levels = [20, 50, 80]
    fracs = [1.0, 0.60, 0.36]
    shifts = [0.0, -0.04, -0.02]
    zones = []
    for level, frac, shift in zip(levels, fracs, shifts):
        zones.append(
            {
                "level": level,
                "cx": round(cx + shift * rx, 2),
                "cy": cy,
                "rx": round(rx * frac, 2),
                "ry": round(ry * frac, 2),
            }
        )
    return zones


def contour(
    *,
    block,
    code,
    topic,
    subtopic,
    title,
    object_name,
    value_name,
    family,
    cx,
    cy,
    rx,
    ry,
    x_ticks,
    y_ticks,
    x_label,
    y_label,
    zone_at,
    depend_one,
    depend_band,
    absolute_text,
    high_x_template,
    externals,
    conditions,
):
    return {
        "block": block,
        "code": code,
        "topic": topic,
        "subtopic": subtopic,
        "form": "contour",
        "layout": "zone",
        "family": family,
        "title": title,
        "object": object_name,
        "source_kind": "pattern",
        "design": "experiment",
        "n_factors": 2,
        "conditions": conditions,
        "iv": "сочетание двух факторов",
        "dv": value_name,
        "factor_gen": "факторов",
        "factor_acc": "",
        "y_name": value_name,
        "y_unit": "%",
        "externals": externals,
        "zone_at": zone_at,
        "depend_one": depend_one,
        "depend_band": depend_band,
        "absolute_text": absolute_text,
        "high_x_template": high_x_template,
        "zone": {
            "x_label": x_label,
            "y_label": y_label,
            "x_lim": [x_ticks[0], x_ticks[-1]],
            "y_lim": [y_ticks[0], y_ticks[-1]],
            "x_ticks": list(x_ticks),
            "y_ticks": list(y_ticks),
            "zones": zone_ellipses(cx, cy, rx, ry),
            "outside": 0,
            "value_name": value_name,
            "value_unit": "%",
            "legend_title": "Уровень, %",
        },
    }


HUM_TICKS_X = list(range(0, 101, 10))
HUM_TICKS_Y = list(range(0, 41, 5))
PH_TICKS = list(range(0, 15))
TEMP_TICKS = list(range(0, 61, 5))
PEP_X = [i / 2 for i in range(0, 17)]
PEP_Y = list(range(20, 61, 5))


def phrases_humidity(value: str) -> dict:
    return dict(
        x_label="Влажность, %",
        y_label="Температура, °C",
        zone_at="при температуре {y} °C и влажности {x} %",
        depend_one="При температуре {y} °C {value} изменяется в зависимости от влажности.",
        depend_band="При температурных значениях от {a} °C до {b} °C {value} изменяется в зависимости от влажности.",
        absolute_text=f"При любых сочетаниях температуры и влажности в пределах шкал графика {value} выше 0 %.",
        high_x_template="При влажности выше {thr} % {value} составляет {level} %.",
    )


def phrases_ph(value: str) -> dict:
    return dict(
        x_label="pH",
        y_label="Температура, °C",
        zone_at="при температуре {y} °C и pH {x}",
        depend_one="При температуре {y} °C {value} изменяется в зависимости от pH.",
        depend_band="При температурных значениях от {a} °C до {b} °C {value} изменяется в зависимости от pH.",
        absolute_text=f"При любых сочетаниях температуры и pH в пределах шкал графика {value} выше 0 %.",
        high_x_template="При pH выше {thr} {value} составляет {level} %.",
    )
