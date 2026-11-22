"""Сборка банка линии 21: справочник, рисунки, JSON, CSV, Moodle, превью."""

from __future__ import annotations

import csv
import html
import json
import random
import re
from collections import Counter, defaultdict
from itertools import permutations
from pathlib import Path

from generator.assemble import assemble_dataset, finalize_question, render_stem
from generator.catalog_cell import cell_contexts
from generator.catalog_div import div_contexts
from generator.catalog_eco import eco_contexts
from generator.catalog_evo import evo_contexts
from generator.catalog_human import human_contexts
from generator.codifier import FORM_QUOTA, FORM_RU
from generator.evaluate import evaluate
from generator.materialize import Reject, materialize
from generator.plots import render, table_html
from generator.statements import build_statements

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "figures"
KB = ROOT / "kb"
MOODLE = ROOT / "moodle"
PREVIEW = ROOT / "preview"
QA = ROOT / "qa"

BLOCK_ORDER = ["cell", "div", "human", "evo", "eco"]
FORM_ORDER = ["table", "line", "bar", "contour", "scatter", "pie"]


def all_contexts() -> list[dict]:
    return cell_contexts() + div_contexts() + human_contexts() + evo_contexts() + eco_contexts()


def _select(ready: list[dict]) -> tuple[list[dict], list[dict]]:
    """Квота по блоку и форме, семьи по кругу. Остаток — запас."""
    chosen = []
    used = set()
    for block in BLOCK_ORDER:
        for form, quota in FORM_QUOTA.items():
            bucket = [ds for ds in ready if ds["block"] == block and ds["form"] == form]
            families = defaultdict(list)
            for ds in bucket:
                families[ds.get("family") or ds["title"]].append(ds)
            keys = sorted(families)
            picked = []
            while len(picked) < quota and any(families[k] for k in keys):
                for key in keys:
                    if families[key] and len(picked) < quota:
                        picked.append(families[key].pop(0))
            for ds in picked:
                used.add(id(ds))
                chosen.append(ds)
    spare = [ds for ds in ready if id(ds) not in used]
    return chosen, spare


def _perms(answer: str) -> list[str]:
    return sorted({"".join(p) for p in permutations(answer)})


def _partial_2026(answer: str, n_stmt: int) -> list[str]:
    correct = set(answer)
    digits = [str(i) for i in range(1, n_stmt + 1)]
    wrong = [d for d in digits if d not in correct]
    bases = set()
    for d in list(correct):
        bases.add("".join(sorted(correct - {d})))
    for w in wrong:
        bases.add("".join(sorted(correct | {w})))
    for d in list(correct):
        for w in wrong:
            bases.add("".join(sorted((correct - {d}) | {w})))
    out = []
    for base in bases:
        if not base or set(base) == correct:
            continue
        out.extend("".join(p) for p in set(permutations(base)))
    return sorted(set(out))


def _xml_text(value: str) -> str:
    return value.replace("]]>", "]]&gt;")


def _stem_html(stem: str, figure: str | None) -> str:
    parts = stem.split("\n\n")
    html_parts = []
    for i, part in enumerate(parts):
        if part.startswith("<table"):
            html_parts.append(part)
        else:
            html_parts.append("<p>" + html.escape(part).replace("\n", "<br>") + "</p>")
        if figure and i == 3:
            html_parts.append(f'<p><img src="@@PLUGINFILE@@/{figure}" alt="{html.escape(figure)}"/></p>')
    return "\n".join(html_parts)


def _category(q: dict) -> str:
    form = FORM_RU.get(q["form"], q["form"])
    topic = q["topic"].replace("/", " ")
    return f"$course$/Биология ЕГЭ/Линия 21/{q['block_title']}/{form}/{topic}"


def _question_xml(q: dict, qtype: str, image_b64: dict[str, str]) -> str:
    stem = q["stem"]
    if qtype == "multichoiceset":
        stem = stem.replace(
            "Выберите утверждения, которые можно сформулировать на основании анализа представленных данных. "
            "Запишите в ответе цифры, под которыми указаны выбранные утверждения.",
            "Отметьте утверждения, которые можно сформулировать на основании анализа представленных данных.",
        )
        stem = stem.replace(
            "На экзамене цифры надёжнее записывать по возрастанию, без пробелов и запятых, как в ключе демоверсии.",
            "В этом тренировочном формате утверждения отмечают, а не записывают цифрами. На экзамене линия 21 — это запись цифр.",
        )
    figure = Path(q["figure_file"]).name if q["figure_file"] else None
    body = _stem_html(stem, figure)
    file_xml = ""
    if figure and figure in image_b64:
        file_xml = f'<file name="{figure}" path="/" encoding="base64">{image_b64[figure]}</file>'
    feedback = "<p>" + html.escape(q["solution"]) + "</p>"
    tags = "".join(f"<tag><text>{html.escape(t)}</text></tag>" for t in q["tags"])
    name = html.escape(q["id"] + (" (2026)" if qtype == "shortanswer2026" else ""))
    if qtype == "multichoiceset":
        name = html.escape(q["id"] + " (отметить)")
    lines = [
        f'<question type="{"shortanswer" if qtype.startswith("shortanswer") else "multichoiceset"}">',
        f"<name><text>{name}</text></name>",
        '<questiontext format="html">',
        f"<text><![CDATA[{_xml_text(body)}]]></text>",
        file_xml,
        "</questiontext>",
        '<generalfeedback format="html">',
        f"<text><![CDATA[{_xml_text(feedback)}]]></text>",
        "</generalfeedback>",
        "<defaultgrade>1</defaultgrade>",
        "<penalty>0</penalty>",
        "<hidden>0</hidden>",
    ]
    if qtype.startswith("shortanswer"):
        lines.append("<usecase>0</usecase>")
        seen = set()
        for ans in _perms(q["answer"]):
            lines.append(f'<answer fraction="100" format="plain_text"><text>{ans}</text></answer>')
            seen.add(ans)
        if qtype == "shortanswer2026":
            for ans in _partial_2026(q["answer"], len(q["statements"])):
                if ans in seen:
                    continue
                lines.append(f'<answer fraction="50" format="plain_text"><text>{ans}</text></answer>')
    else:
        lines.append("<shuffleanswers>0</shuffleanswers>")
        lines.append("<answernumbering>123</answernumbering>")
        lines.append('<correctfeedback format="html"><text>Верно.</text></correctfeedback>')
        lines.append('<incorrectfeedback format="html"><text>Неверно.</text></incorrectfeedback>')
        for stmt in q["statements"]:
            frac = "100" if stmt["verdict"] == "follows" else "0"
            lines.append(
                f'<answer fraction="{frac}" format="html"><text><![CDATA[{_xml_text(html.escape(stmt["text"]))}]]></text></answer>'
            )
    lines.append(f"<tags>{tags}</tags>")
    lines.append("</question>")
    return "\n".join(line for line in lines if line != "")


def _write_quiz(path: Path, groups: list[tuple[str, list[dict]]], qtype: str, image_b64: dict[str, str]) -> None:
    chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<quiz>"]
    for cat, items in groups:
        chunks.append("<question type=\"category\"><category><text>" + html.escape(cat) + "</text></category></question>")
        for q in items:
            chunks.append(_question_xml(q, qtype, image_b64))
    chunks.append("</quiz>\n")
    path.write_text("\n".join(chunks), encoding="utf-8")


def _groups_of(questions: list[dict], size: int) -> list[list[dict]]:
    return [questions[i : i + size] for i in range(0, len(questions), size)]


def _preview_block(block: str, questions: list[dict], path: Path) -> None:
    parts = [
        "<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"utf-8\">",
        f"<title>Линия 21 — {html.escape(block)}</title>",
        "<style>body{font-family:Georgia,serif;max-width:980px;margin:24px auto;line-height:1.45}",
        "img{max-width:100%;height:auto} .q{border-top:1px solid #ccc;padding:16px 0}",
        "table{border-collapse:collapse} td,th{border:1px solid #444;padding:4px 8px}</style></head><body>",
        f"<h1>{html.escape(block)}</h1>",
    ]
    for q in questions:
        parts.append('<article class="q">')
        parts.append(f"<h2>{html.escape(q['id'])}. {html.escape(q['title'])}</h2>")
        parts.append(
            f"<p><b>{html.escape(q['codifier_section'])}</b> · {html.escape(FORM_RU.get(q['form'], q['form']))} · "
            f"сложность {q['difficulty']} · эталон {html.escape(q['answer'])}</p>"
        )
        if q["figure_file"]:
            rel = Path(os_rel(q["figure_file"]))
            parts.append(f'<p><img src="../{html.escape(str(rel))}" alt=""></p>')
        parts.append(_stem_html(q["stem"], None).replace("@@PLUGINFILE@@/", "../figures/"))
        parts.append("<h3>Разбор</h3>")
        parts.append(f"<p>{html.escape(q['solution'])}</p>")
        parts.append("<ul>")
        for i, stmt in enumerate(q["statements"], 1):
            parts.append(
                f"<li>{i}. {html.escape(stmt['verdict'])}"
                f"{(' / ' + html.escape(stmt['error_type'])) if stmt['error_type'] else ''}"
                f" — {html.escape(stmt['text'])}</li>"
            )
        parts.append("</ul></article>")
    parts.append("</body></html>")
    path.write_text("\n".join(parts), encoding="utf-8")


def os_rel(path: str) -> str:
    return path


def build() -> dict:
    FIG.mkdir(exist_ok=True)
    KB.mkdir(exist_ok=True)
    MOODLE.mkdir(exist_ok=True)
    PREVIEW.mkdir(exist_ok=True)
    QA.mkdir(exist_ok=True)
    rng = random.Random(21)
    rejected = []
    ready = []
    for ctx in all_contexts():
        try:
            ds = materialize(ctx)
        except Reject as exc:
            rejected.append({"title": ctx.get("title"), "reason": str(exc), "stage": "materialize"})
            continue
        pool = build_statements(ds)
        if len(pool) < 12:
            rejected.append({"title": ds["title"], "reason": "короткий пул", "stage": "statements"})
            continue
        ds["_pool"] = pool
        ready.append(ds)
    chosen, spare = _select(ready)
    # Стабильные идентификаторы.
    chosen.sort(key=lambda ds: (BLOCK_ORDER.index(ds["block"]), ds["code"], FORM_ORDER.index(ds["form"]), ds["title"]))
    counters = Counter()
    for ds in chosen:
        counters[ds["code"]] += 1
        code = ds["code"].replace(".", "")
        ds["dataset_id"] = f"DS-{code}-{counters[ds['code']]:03d}"
        for i, stmt in enumerate(ds["_pool"], 1):
            stmt["stmt_id"] = f"{ds['dataset_id']}-S{i:02d}"
    spare_by = defaultdict(list)
    for ds in spare:
        spare_by[(ds["block"], ds["form"])].append(ds)

    built = []
    for slot, ds in enumerate(chosen):
        drafts = assemble_dataset(ds, ds["_pool"], rng, slot)
        if len(drafts) < 4:
            replacement = None
            while spare_by[(ds["block"], ds["form"])]:
                alt = spare_by[(ds["block"], ds["form"])].pop(0)
                alt_pool = alt["_pool"]
                counters[alt["code"]] += 1
                code = alt["code"].replace(".", "")
                alt["dataset_id"] = f"DS-{code}-{counters[alt['code']]:03d}"
                for i, stmt in enumerate(alt_pool, 1):
                    stmt["stmt_id"] = f"{alt['dataset_id']}-S{i:02d}"
                alt_drafts = assemble_dataset(alt, alt_pool, rng, slot)
                if len(alt_drafts) >= 4:
                    rejected.append({"title": ds["title"], "reason": f"собралось только {len(drafts)} заданий", "stage": "assemble"})
                    ds = alt
                    drafts = alt_drafts
                    replacement = alt
                    break
            if replacement is None and len(drafts) < 4:
                rejected.append({"title": ds["title"], "reason": f"собралось только {len(drafts)} заданий", "stage": "assemble-drop"})
                continue
        built.append((ds, drafts))

    # Рисунки.
    specs = []
    for ds, _drafts in built:
        if ds["form"] == "table":
            continue
        spec = render(ds, FIG / f"{ds['dataset_id']}.png")
        spec["file"] = f"figures/{ds['dataset_id']}.png"
        specs.append(spec)

    questions = []
    number = 1
    for ds, drafts in built:
        table = table_html(ds) if ds["form"] == "table" else None
        for draft in drafts:
            questions.append(finalize_question(ds, draft, number, table))
            number += 1

    report = _qa(questions, built, rejected)
    _export(questions, built, specs, rejected, report)
    return report


def _qa(questions: list[dict], built, rejected) -> dict:
    problems = []
    keys = Counter()
    forms = Counter()
    blocks = Counter()
    ncorr = Counter()
    diff = Counter()
    codes = Counter()
    seen_sets = set()
    for q in questions:
        keys[q["answer"]] += 1
        forms[q["form"]] += 1
        blocks[q["block"]] += 1
        ncorr[q["answer"] and len(q["answer"])] += 1
        diff[q["difficulty"]] += 1
        codes[q["codifier_code"]] += 1
        sig = (q["dataset_id"], tuple(sorted(s["stmt_id"] for s in q["statements"])))
        if sig in seen_sets:
            problems.append(f"{q['id']} дубликат набора утверждений")
        seen_sets.add(sig)
        if len(q["answer"]) not in {2, 3}:
            problems.append(f"{q['id']} число верных {q['answer']}")
        if q["answer"] != "".join(sorted(q["answer"])) or len(set(q["answer"])) != len(q["answer"]):
            problems.append(f"{q['id']} эталон не по возрастанию")
        recomputed = []
        types = set()
        for i, stmt in enumerate(q["statements"], 1):
            got = evaluate(q["data"], stmt["predicate"])
            if stmt["verdict"] == "follows" and got is not True:
                problems.append(f"{q['id']} пункт {i} не подтверждается данными")
            if stmt["verdict"] == "contradicts" and got is not False:
                problems.append(f"{q['id']} пункт {i} не противоречит данным")
            if stmt["verdict"] == "not_in_data" and got is not None:
                problems.append(f"{q['id']} пункт {i} на самом деле читается из данных")
            if got is True:
                recomputed.append(str(i))
            if stmt["error_type"]:
                types.add(stmt["error_type"])
        if "".join(recomputed) != q["answer"]:
            problems.append(f"{q['id']} эталон {q['answer']} != {''.join(recomputed)}")
        if len(types) < 2:
            problems.append(f"{q['id']} один тип ошибки")
        blob = (q["stem"] + q["title"]).lower()
        if "коконопряд" in blob or ("соснов" in blob and "влажн" in blob):
            problems.append(f"{q['id']} сюжет демоверсии")
        if q["figure_file"] and not (ROOT / q["figure_file"]).exists():
            problems.append(f"{q['id']} нет рисунка")
        if q["form"] != "table" and not q["figure_file"]:
            problems.append(f"{q['id']} график без файла")
        if q["form"] == "table" and "<table" not in q["stem"]:
            problems.append(f"{q['id']} таблица не вставлена в условие")
    # Близкие дубликаты внутри набора данных.
    by_ds = defaultdict(list)
    for q in questions:
        by_ds[q["dataset_id"]].append(set(s["stmt_id"] for s in q["statements"]))
    near = 0
    for sets in by_ds.values():
        for i in range(len(sets)):
            for j in range(i + 1, len(sets)):
                if len(sets[i] & sets[j]) >= 4:
                    near += 1
    datasets_n = len(built)
    figures_n = sum(1 for ds, _ in built if ds["form"] != "table")
    return {
        "questions": len(questions),
        "datasets": datasets_n,
        "figures": figures_n,
        "statements_in_pools": sum(len(ds["_pool"]) for ds, _ in built),
        "rejected": rejected,
        "problems": problems[:80],
        "problem_count": len(problems),
        "near_duplicates": near,
        "forms": dict(forms),
        "blocks": dict(blocks),
        "n_correct": {str(k): v for k, v in ncorr.items()},
        "difficulty": {str(k): v for k, v in diff.items()},
        "codes": dict(codes),
        "answers": dict(keys.most_common(30)),
        "answer_top_share": (keys.most_common(1)[0][1] / len(questions)) if questions else 0,
    }


def _export(questions, built, specs, rejected, report) -> None:
    # Справочник наборов.
    datasets = []
    statements = []
    for ds, _drafts in built:
        datasets.append(
            {
                "dataset_id": ds["dataset_id"],
                "block": ds["block"],
                "block_title": ds["block_title"],
                "codifier_section": ds["codifier_section"],
                "code": ds["code"],
                "form": ds["form"],
                "title": ds["title"],
                "source_kind": ds["source_kind"],
                "source_note": ds["source_note"],
                "design": ds["design"],
                "n_factors": ds.get("n_factors", 1),
                "conditions": ds["conditions"],
                "iv": ds.get("iv"),
                "dv": ds.get("dv"),
                "object": ds.get("object"),
                "x": ds.get("x"),
                "y_unit": ds.get("y_unit"),
                "series": ds.get("series"),
                "zone": ds.get("zone"),
                "matrix": ds.get("matrix"),
                "points": ds.get("points"),
                "can_claim": ds.get("can_claim"),
                "cannot_claim": ds.get("cannot_claim"),
                "figure_file": "" if ds["form"] == "table" else f"figures/{ds['dataset_id']}.png",
            }
        )
        for stmt in ds["_pool"]:
            statements.append(
                {
                    "stmt_id": stmt["stmt_id"],
                    "dataset_id": ds["dataset_id"],
                    "text": stmt["text"],
                    "verdict": stmt["verdict"],
                    "error_type": stmt["error_type"],
                    "subtype": stmt["subtype"],
                    "checks": stmt["checks"],
                    "unambiguous": True,
                }
            )
    (KB / "datasets.json").write_text(json.dumps(datasets, ensure_ascii=False, indent=1), encoding="utf-8")
    (KB / "statements.json").write_text(json.dumps(statements, ensure_ascii=False, indent=1), encoding="utf-8")
    (KB / "plot_specs.json").write_text(json.dumps(specs, ensure_ascii=False, indent=1), encoding="utf-8")
    (KB / "rejected.json").write_text(json.dumps(rejected, ensure_ascii=False, indent=1), encoding="utf-8")
    (KB / "manifest.json").write_text(
        json.dumps(
            {
                "line": 21,
                "year": 2027,
                "datasets": len(datasets),
                "statements": len(statements),
                "figures": len(specs),
                "questions": len(questions),
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    bank = []
    for q in questions:
        item = dict(q)
        bank.append(item)
    (ROOT / "bank_line21.json").write_text(json.dumps(bank, ensure_ascii=False), encoding="utf-8")
    with (ROOT / "bank_line21.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["id", "answer", "n_correct", "difficulty", "form", "code", "block", "topic", "dataset_id", "figure_file", "n_statements"])
        for q in questions:
            writer.writerow(
                [
                    q["id"],
                    q["answer"],
                    len(q["answer"]),
                    q["difficulty"],
                    q["form"],
                    q["codifier_code"],
                    q["block"],
                    q["topic"],
                    q["dataset_id"],
                    q["figure_file"],
                    len(q["statements"]),
                ]
            )
    # Картинки в base64 один раз.
    import base64

    image_b64 = {}
    for spec in specs:
        raw = (ROOT / spec["file"]).read_bytes()
        image_b64[Path(spec["file"]).name] = base64.b64encode(raw).decode("ascii")
    by_cat = defaultdict(list)
    for q in questions:
        by_cat[_category(q)].append(q)
    groups = list(by_cat.items())
    # Файлы по 150 вопросов.
    part = 1
    buf = []
    buf_n = 0
    part_paths = []
    for cat, items in groups:
        if buf_n and buf_n + len(items) > 160:
            path = MOODLE / f"line21_part{part:02d}.xml"
            _write_quiz(path, buf, "shortanswer", image_b64)
            part_paths.append(path.name)
            part += 1
            buf = []
            buf_n = 0
        buf.append((cat, items))
        buf_n += len(items)
    if buf:
        path = MOODLE / f"line21_part{part:02d}.xml"
        _write_quiz(path, buf, "shortanswer", image_b64)
        part_paths.append(path.name)
    _write_quiz(MOODLE / "line21_2026_partial.xml", groups, "shortanswer2026", image_b64)
    _write_quiz(MOODLE / "line21_multichoiceset.xml", groups, "multichoiceset", image_b64)
    # Общий файл, если он легче 90 МБ. Иначе общий файл не дублирует части.
    combined = MOODLE / "line21_all.xml"
    _write_quiz(combined, groups, "shortanswer", image_b64)
    by_block = defaultdict(list)
    for q in questions:
        by_block[q["block_title"]].append(q)
    links = []
    for block, items in by_block.items():
        slug = re.sub(r"[^0-9a-zA-Zа-яА-Я]+", "-", block).strip("-")
        fname = f"{slug}.html"
        _preview_block(block, items, PREVIEW / fname)
        links.append((block, fname, len(items)))
    index = [
        "<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"utf-8\"><title>Линия 21. Превью</title></head><body>",
        "<h1>Банк линии 21 ЕГЭ по биологии, 2027</h1>",
        "<p>Эталон в банке записан по возрастанию. На экзамене цифры надёжнее писать так же, без пробелов и запятых. "
        "Спецификация 2027 года для линии 21 не говорит, что порядок не важен: верно только полное совпадение с эталоном, 1 или 0 баллов.</p>",
        "<ul>",
    ]
    for block, fname, n in links:
        index.append(f'<li><a href="preview/{html.escape(fname)}">{html.escape(block)}</a> — {n} заданий</li>')
    index.append("</ul></body></html>")
    (ROOT / "preview.html").write_text("\n".join(index), encoding="utf-8")
    (QA / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    _readme(report, part_paths, combined)


def _readme(report: dict, part_paths: list[str], combined: Path) -> None:
    size_mb = combined.stat().st_size / (1024 * 1024)
    forms = report["forms"]
    total = report["questions"] or 1
    table_share = forms.get("table", 0) / total
    graph_share = 1 - table_share
    graphs = total - forms.get("table", 0)
    contour_share = forms.get("contour", 0) / graphs if graphs else 0
    lines = [
        "# Банк заданий. ЕГЭ по биологии, линия 21 (2027)",
        "",
        "Анализ экспериментальных данных в табличной или графической форме: выбрать утверждения, которые можно сформулировать по представленным данным.",
        "",
        "Официальный уровень — базовый. Максимальный первичный балл — **1**. Код требования — 9. Коды содержания: 1.1–1.3, 2.1–2.6, 4.2–4.6, 5.1–5.7, 6.1–6.5, 7.1–7.6.",
        "",
        "## Правило оценивания 2027 года",
        "",
        "В спецификации 2027 года линия 21 стоит в одной группе с заданиями 1, 3, 4, 5, 9 и 13: ответ верный, только если он записан в нужной форме и **полностью совпадает с эталоном**. Иначе 0 баллов. Частичного балла за одну ошибку нет.",
        "",
        "В 2026 году задание 21 входило в группу 7, 11, 15, 17, 18, 21: максимум был 2 балла, порядок цифр не имел значения, 1 балл ставили за одну ошибку в символе. В 2027 году содержание задания то же, но максимум снижен с 2 до 1, а у задания 26 максимум вырос с 3 до 4. Сумма первичных баллов осталась 57. В краткой справке ФИПИ «Изменений нет» речь о структуре работы и общей сумме, а не об этой перестановке баллов. У заданий 7, 11, 15, 17 и 18 оговорка «порядок записи символов значения не имеет» сохранена. У линии 21 её больше нет.",
        "",
        "Эталон в банке записан **по возрастанию**, без пробелов и запятых, как `13` в ключе демоверсии. На экзамене цифры надёжнее писать так же. Спецификация 2027 года для линии 21 не говорит, что порядок не важен.",
        "",
        "Код 4.6 указан в спецификации (задания 9 и 21). В таблице кодификатора абзац про эволюционное усложнение нервной системы идёт продолжением 4.5. В банке этот сюжет помечен 4.6, как в спецификации.",
        "",
        "## Состав",
        "",
        f"- Заданий: **{report['questions']}**.",
        f"- Наборов данных: **{report['datasets']}**. Утверждений в пулах: **{report['statements_in_pools']}**.",
        f"- Рисунков: **{report['figures']}**.",
        f"- Отбраковано наборов: **{len(report['rejected'])}**.",
        f"- Близких дубликатов (4 и более общих утверждений из пяти внутри одного набора): **{report['near_duplicates']}**.",
        f"- Расхождений при пересчёте эталона: **{report['problem_count']}**.",
        "",
        "Доли форм (задания):",
        "",
    ]
    for form in FORM_ORDER:
        n = forms.get(form, 0)
        lines.append(f"- {FORM_RU[form]}: {n} ({n / total:.1%})")
    lines += [
        "",
        f"Таблицы {table_share:.1%}, графики {graph_share:.1%}. Среди графиков зоны составляют {contour_share:.1%}.",
        "",
        "Число верных утверждений: " + ", ".join(f"{k} — {v}" for k, v in sorted(report["n_correct"].items())) + ".",
        "",
        "Сложность: " + ", ".join(f"{k} — {v}" for k, v in sorted(report["difficulty"].items())) + ".",
        "",
        "Самые частые эталоны: " + ", ".join(f"{k} ({v})" for k, v in list(report["answers"].items())[:12]) + ".",
        "",
        "Задания по разделам:",
        "",
    ]
    for block, n in report["blocks"].items():
        lines.append(f"- {block}: {n}")
    lines += [
        "",
        "Задания по кодам:",
        "",
    ]
    for code, n in sorted(report["codes"].items()):
        lines.append(f"- {code}: {n}")
    lines += [
        "",
        "Данные подписаны как условные или как построенные по мотивам школьной закономерности. Это не выписки из статей. Сюжет демоверсии (сосновый коконопряд, влажность и температура, утверждения про 10 °C и 30 %, «любые значения», 8–23 °C, «выше 60 % выживают все», «наиболее благоприятно 60 % и 10 °C») в банк не входит.",
        "",
        "Раздел 3 кодификатора (генетика, родословные, расщепление) в линию 21 не входит и в банке нет.",
        "",
        "## Импорт в Moodle",
        "",
        "Основной пакет — короткий ответ на 1 балл, всё или ничего:",
        "",
    ]
    for name in part_paths:
        lines.append(f"- `moodle/{name}`")
    lines += [
        f"- `moodle/line21_all.xml` — тот же банк одним файлом ({size_mb:.0f} МБ).",
        "",
        "На 100 % принимается эталон по возрастанию и любая перестановка тех же цифр. Это сделано для тренировки, чтобы порядок не штрафовался в Moodle. На экзамене 2027 года такой оговорки для линии 21 нет: надёжнее писать цифры по возрастанию.",
        "",
        "Частичного балла в основном пакете нет. Файл `moodle/line21_2026_partial.xml` — отдельный режим 2026 года: те же полные ответы на 100 % и дополнительно 50 % за ровно одну ошибку (лишняя, пропущенная или заменённая цифра, в любом порядке). Этот файл не заменяет основной.",
        "",
        "Файл `moodle/line21_multichoiceset.xml` — необязательный формат «отметить утверждения» типа multichoiceset (всё или ничего). Нужен тип вопроса «множественный выбор всё или ничего». Обычный множественный выбор с весами «плюс за верный, минус за неверный» даёт частичный балл и **не** повторяет правило 2027 года, поэтому таким файлом банк не снабжён. На экзамене ответ записывают цифрами, а не флажками.",
        "",
        "Рисунки встроены в вопрос (`@@PLUGINFILE@@`). Таблицы стоят в условии как HTML. Разбор — в общем отзыве. Категория: `Биология ЕГЭ/Линия 21/<раздел>/<форма>/<тема>`.",
        "",
        "Импорт: Банк вопросов → Импорт → Формат Moodle XML. Крупные файлы лучше грузить по частям.",
        "",
        "## Файлы",
        "",
        "- `bank_line21.json`, `bank_line21.csv` — задания. В JSON у каждого утверждения есть предикат, по которому эталон пересчитывается.",
        "- `kb/datasets.json`, `kb/statements.json`, `kb/plot_specs.json` — справочник.",
        "- `figures/` — PNG.",
        "- `preview.html` и `preview/` — просмотр для преподавателя.",
        "- `generator/` — сборка: `python3 -m generator.build_bank`.",
        "- `qa/report.json` — отчёт проверки.",
        "",
        "## Как устроен генератор",
        "",
        "Справочник задаёт числа и границы зон. Утверждение попадает в пул, только если пересчёт предиката совпал с вердиктом: следует, противоречит или из данных не следует. Задание берёт два или три верных утверждения и остальные неверные разных типов ошибок. Эталон — номера верных пунктов по возрастанию. Четыре и более общих утверждений из пяти внутри одного набора не допускаются.",
        "",
    ]
    if report["rejected"]:
        lines.append("Отбракованные наборы:")
        lines.append("")
        for item in report["rejected"][:40]:
            lines.append(f"- {item.get('title', '')[:80]} — {item.get('reason')}")
        lines.append("")
    (ROOT / "README.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    result = build()
    print(json.dumps({k: result[k] for k in ("questions", "datasets", "figures", "problem_count", "near_duplicates", "forms", "n_correct")}, ensure_ascii=False, indent=1))
