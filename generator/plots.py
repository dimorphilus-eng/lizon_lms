"""Рисунки matplotlib: чёрно-белая печать, подписи, единицы."""

from __future__ import annotations

import textwrap
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Patch

from generator.textutil import fmt_num

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "axes.unicode_minus": False,
        "hatch.linewidth": 0.7,
        "figure.dpi": 120,
        "savefig.dpi": 120,
    }
)

HATCHES = ["...", "///", "---", "xxx"]


def render(ds: dict, path: Path) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    form = ds["form"]
    if form == "line":
        spec = _line(ds, path)
    elif form == "bar":
        spec = _bar(ds, path)
    elif form == "contour":
        spec = _contour(ds, path)
    elif form == "scatter":
        spec = _scatter(ds, path)
    elif form == "pie":
        spec = _pie(ds, path)
    else:
        raise ValueError(form)
    spec.update(
        {
            "dataset_id": ds["dataset_id"],
            "file": str(path.as_posix()),
            "font": "DejaVu Sans",
            "dpi": 120,
            "size_in": [9.2, 5.6],
            "monochrome": True,
        }
    )
    return spec


def table_html(ds: dict) -> str:
    if ds["layout"] == "matrix":
        return _matrix_html(ds)
    if ds["layout"] == "points":
        return _points_html(ds)
    return _series_html(ds)


def _wrap_title(title: str) -> str:
    return "\n".join(textwrap.wrap(title, width=72))


def _finish(fig, ax, path: Path, note: str) -> None:
    fig.text(0.01, 0.012, note, fontsize=8, fontstyle="italic")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    # Серый PNG меньше весит и остаётся читаемым в чёрно-белой печати.
    from PIL import Image

    with Image.open(path) as im:
        im.convert("L").save(path, optimize=True)


def _line(ds: dict, path: Path) -> dict:
    fig, ax = plt.subplots(figsize=(9.2, 5.6))
    styles = [
        dict(color="black", marker="o", linestyle="-", markersize=7),
        dict(color="#333333", marker="s", linestyle="--", markersize=6.5),
        dict(color="#555555", marker="D", linestyle="-.", markersize=6),
    ]
    xs = ds["x"]
    numeric = all(not isinstance(x, str) for x in xs)
    x_pos = list(range(len(xs))) if not numeric else [float(x) for x in xs]
    all_y = [y for s in ds["series"] for y in s["y"]]
    ymin, ymax = min(all_y), max(all_y)
    span = ymax - ymin or 1
    for idx, series in enumerate(ds["series"]):
        style = styles[idx % len(styles)]
        ax.plot(x_pos, series["y"], label=series["name"], linewidth=1.8, **style)
        offset = 8 if idx % 2 == 0 else -12
        va = "bottom" if offset > 0 else "top"
        for x, y in zip(x_pos, series["y"]):
            ax.annotate(
                fmt_num(y),
                (x, y),
                textcoords="offset points",
                xytext=(0, offset),
                ha="center",
                va=va,
                fontsize=8,
            )
    pad = span * 0.28
    ax.set_ylim(ymin - pad * 0.55, ymax + pad)
    if not numeric:
        ax.set_xticks(x_pos)
        ax.set_xticklabels([str(x) for x in xs], rotation=20 if any(len(str(x)) > 12 for x in xs) else 0, ha="right" if any(len(str(x)) > 12 for x in xs) else "center")
    ax.set_title(_wrap_title(ds["title"]), fontsize=11)
    ax.set_xlabel(_axis(ds["x_name"], ds["x_unit"]), fontsize=10)
    ax.set_ylabel(_axis(ds["y_name"], ds["y_unit"]), fontsize=10)
    ax.grid(True, linestyle=":", alpha=0.8)
    if len(ds["series"]) > 1:
        ax.legend(frameon=True, fontsize=9)
    _finish(fig, ax, path, ds["source_note"])
    return {
        "kind": "line",
        "xlabel": _axis(ds["x_name"], ds["x_unit"]),
        "ylabel": _axis(ds["y_name"], ds["y_unit"]),
        "legend": [s["name"] for s in ds["series"]] if len(ds["series"]) > 1 else [],
        "annotated": True,
    }


def _bar(ds: dict, path: Path) -> dict:
    fig, ax = plt.subplots(figsize=(9.2, 5.6))
    xs = ds["x"]
    n = len(xs)
    k = len(ds["series"])
    width = 0.36 if k > 1 else 0.62
    hatches = ["", "///", "..."]
    positions = list(range(n))
    all_y = [y for s in ds["series"] for y in s["y"]]
    for idx, series in enumerate(ds["series"]):
        shift = (idx - (k - 1) / 2) * width
        bars = ax.bar(
            [p + shift for p in positions],
            series["y"],
            width=width * 0.92,
            label=series["name"],
            color="white",
            edgecolor="black",
            hatch=hatches[idx % len(hatches)],
            zorder=2,
        )
        ax.bar_label(bars, labels=[fmt_num(y) for y in series["y"]], padding=3, fontsize=8)
    ax.set_xticks(positions)
    ax.set_xticklabels([str(x) for x in xs], rotation=18 if any(len(str(x)) > 14 for x in xs) else 0, ha="right" if any(len(str(x)) > 14 for x in xs) else "center")
    top = max(all_y)
    bottom = min(0, min(all_y))
    span = top - bottom or 1
    ax.set_ylim(bottom - span * 0.06, top + span * 0.2)
    ax.set_title(_wrap_title(ds["title"]), fontsize=11)
    ax.set_xlabel(_axis(ds["x_name"], ds["x_unit"]), fontsize=10)
    ax.set_ylabel(_axis(ds["y_name"], ds["y_unit"]), fontsize=10)
    ax.grid(True, axis="y", linestyle=":", zorder=0)
    if k > 1:
        ax.legend(frameon=True, fontsize=9)
    _finish(fig, ax, path, ds["source_note"])
    return {
        "kind": "bar",
        "xlabel": _axis(ds["x_name"], ds["x_unit"]),
        "ylabel": _axis(ds["y_name"], ds["y_unit"]),
        "legend": [s["name"] for s in ds["series"]] if k > 1 else [],
        "hatches": hatches[:k],
        "annotated": True,
    }


def _contour(ds: dict, path: Path) -> dict:
    zone = ds["zone"]
    fig, ax = plt.subplots(figsize=(9.2, 5.8))
    handles = []
    for idx, item in enumerate(zone["zones"]):
        hatch = HATCHES[idx % len(HATCHES)]
        ell = Ellipse(
            (item["cx"], item["cy"]),
            width=2 * item["rx"],
            height=2 * item["ry"],
            facecolor="white",
            edgecolor="black",
            hatch=hatch,
            linewidth=1.3,
            zorder=2 + idx,
        )
        ax.add_patch(ell)
        handles.append(
            Patch(
                facecolor="white",
                edgecolor="black",
                hatch=hatch,
                label=f"{fmt_num(item['level'])} {zone['value_unit']}",
            )
        )
    handles.append(
        Patch(
            facecolor="white",
            edgecolor="black",
            label=f"{fmt_num(zone['outside'])} {zone['value_unit']} (вне контуров)",
        )
    )
    ax.set_xlim(*zone["x_lim"])
    ax.set_ylim(*zone["y_lim"])
    ax.set_xticks(zone["x_ticks"])
    ax.set_yticks(zone["y_ticks"])
    ax.grid(True, linestyle=":", zorder=8, alpha=0.85)
    ax.set_title(_wrap_title(ds["title"]), fontsize=11)
    ax.set_xlabel(zone["x_label"], fontsize=10)
    ax.set_ylabel(zone["y_label"], fontsize=10)
    ax.legend(
        handles=handles,
        title=zone["legend_title"],
        frameon=True,
        fontsize=8,
        title_fontsize=9,
        loc="upper left",
        bbox_to_anchor=(1.01, 1.0),
    )
    _finish(fig, ax, path, "Вне контуров значение равно 0. " + ds["source_note"])
    return {
        "kind": "contour",
        "xlabel": zone["x_label"],
        "ylabel": zone["y_label"],
        "legend": [h.get_label() for h in handles],
        "hatches": HATCHES[: len(zone["zones"])],
        "zones": zone["zones"],
        "annotated": False,
    }


def _scatter(ds: dict, path: Path) -> dict:
    fig, ax = plt.subplots(figsize=(9.2, 5.6))
    xs = [p["x"] for p in ds["points"]]
    ys = [p["y"] for p in ds["points"]]
    ax.scatter(xs, ys, s=46, c="black", zorder=3)
    for p in ds["points"]:
        ax.annotate(
            f"{p['name']}: {fmt_num(p['y'])}",
            (p["x"], p["y"]),
            textcoords="offset points",
            xytext=(6, 6),
            fontsize=8,
        )
    span_x = max(xs) - min(xs) or 1
    span_y = max(ys) - min(ys) or 1
    ax.set_xlim(min(xs) - span_x * 0.12, max(xs) + span_x * 0.28)
    ax.set_ylim(min(ys) - span_y * 0.18, max(ys) + span_y * 0.28)
    ax.set_title(_wrap_title(ds["title"]), fontsize=11)
    ax.set_xlabel(_axis(ds["x_name"], ds["x_unit"]), fontsize=10)
    ax.set_ylabel(_axis(ds["y_name"], ds["y_unit"]), fontsize=10)
    ax.grid(True, linestyle=":", alpha=0.8)
    _finish(fig, ax, path, ds["source_note"])
    return {
        "kind": "scatter",
        "xlabel": _axis(ds["x_name"], ds["x_unit"]),
        "ylabel": _axis(ds["y_name"], ds["y_unit"]),
        "legend": [],
        "annotated": True,
    }


def _pie(ds: dict, path: Path) -> dict:
    fig, ax = plt.subplots(figsize=(8.4, 5.8))
    series = ds["series"][0]
    # Для круговой диаграммы категории лежат на оси x, доли — в единственном ряду.
    labels = [f"{name} — {fmt_num(y)} %" for name, y in zip(ds["x"], series["y"])]
    hatches = ["", "///", "---", "xxx", "...", "\\\\"]
    wedges, _ = ax.pie(
        series["y"],
        startangle=90,
        colors=["white"] * len(series["y"]),
        wedgeprops=dict(edgecolor="black", linewidth=1),
    )
    for wedge, hatch in zip(wedges, hatches):
        wedge.set_hatch(hatch)
    ax.legend(wedges, labels, loc="center left", bbox_to_anchor=(1.0, 0.5), frameon=True, fontsize=9)
    ax.set_title(_wrap_title(ds["title"]), fontsize=11)
    _finish(fig, ax, path, ds["source_note"])
    return {
        "kind": "pie",
        "xlabel": "",
        "ylabel": "",
        "legend": labels,
        "annotated": True,
    }


def _axis(name: str, unit: str) -> str:
    label = name[:1].upper() + name[1:] if name else name
    if unit:
        return f"{label}, {unit}"
    return label


def _series_html(ds: dict) -> str:
    x_head = _axis(ds["x_name"], ds["x_unit"])
    heads = [x_head]
    show_name = len(ds["series"]) > 1
    for series in ds["series"]:
        label = series["name"] if show_name else ds["y_name"]
        heads.append(_axis(label[:1].upper() + label[1:] if not show_name else label, ds["y_unit"]))
        if series.get("spread") is not None:
            heads.append(f"Разброс (максимум − минимум), {ds['y_unit']}")
    rows = []
    for i, x in enumerate(ds["x"]):
        cells = [f"<td>{_esc(x)}</td>"]
        for series in ds["series"]:
            cells.append(f"<td>{fmt_num(series['y'][i])}</td>")
            if series.get("spread") is not None:
                cells.append(f"<td>{fmt_num(series['spread'][i])}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return _table(ds["title"], heads, rows)


def _matrix_html(ds: dict) -> str:
    matrix = ds["matrix"]
    heads = ["Показатель"] + [c["label"] for c in matrix["columns"]]
    rows = []
    for row in matrix["rows"]:
        cells = [f"<td>{_esc(row['label'])}</td>"]
        for col in matrix["columns"]:
            cells.append(f"<td>{fmt_num(row['values'][col['key']])} {row['unit']}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return _table(ds["title"], heads, rows)


def _points_html(ds: dict) -> str:
    heads = ["Объект", _axis(ds["x_name"], ds["x_unit"]), _axis(ds["y_name"], ds["y_unit"])]
    rows = []
    for p in ds["points"]:
        rows.append(
            "<tr>"
            f"<td>{_esc(p['name'])}</td><td>{fmt_num(p['x'])}</td><td>{fmt_num(p['y'])}</td>"
            "</tr>"
        )
    return _table(ds["title"], heads, rows)


def _table(title: str, heads: list[str], rows: list[str]) -> str:
    head = "".join(f"<th>{_esc(h)}</th>" for h in heads)
    return (
        '<table border="1" cellpadding="4" cellspacing="0">'
        f"<caption><b>{_esc(title)}</b></caption>"
        f"<thead><tr>{head}</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def _esc(value) -> str:
    text = str(value)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
