"""Сборка заданий из пула: 2 или 3 верных, разные типы ошибок, эталон по возрастанию."""

from __future__ import annotations

import random

from generator.evaluate import evaluate
from generator.textutil import cap, ru_and

EXAM_NOTE = (
    "На экзамене цифры надёжнее записывать по возрастанию, без пробелов и запятых, "
    "как в ключе демоверсии."
)

# На 20 заданий: сложность 1/2/3 = 6/9/5, два верных — 11, три — 9,
# четыре утверждения — 1, шесть — 1, остальные по пять.
_DIFF = [1, 2, 3, 2, 1, 2, 3, 1, 2, 2, 1, 2, 3, 2, 1, 2, 3, 1, 2, 3]
_NCORR = [2, 2, 3, 2, 3, 2, 2, 3, 2, 3, 2, 2, 3, 2, 3, 2, 2, 3, 2, 3]
_NSTMT = [5, 5, 5, 4, 5, 5, 5, 5, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]


def assemble_dataset(ds: dict, pool: list[dict], rng: random.Random, slot: int) -> list[dict]:
    questions = []
    for k in range(5):
        idx = slot * 5 + k
        diff = _DIFF[idx % len(_DIFF)]
        if ds["form"] == "contour" and diff == 1:
            diff = 2
        n_corr = _NCORR[idx % len(_NCORR)]
        n_stmt = _NSTMT[idx % len(_NSTMT)]
        if n_stmt == 4:
            n_corr = 2
        built = None
        for _ in range(80):
            built = _one(ds, pool, rng, diff, n_stmt, n_corr, questions)
            if built:
                break
        if not built and diff == 1:
            for _ in range(40):
                built = _one(ds, pool, rng, 2, n_stmt, n_corr, questions)
                if built:
                    break
        if built:
            questions.append(built)
    return questions


def _one(ds, pool, rng, diff, n_stmt, n_corr, existing) -> dict | None:
    follows = [s for s in pool if s["verdict"] == "follows"]
    bad = [s for s in pool if s["verdict"] != "follows"]
    if diff == 1:
        follows = [s for s in follows if s["subtype"] in {"point", "compare", "max"} and s["difficulty"] == 1]
        bad = [
            s
            for s in bad
            if s["error_type"] in {"contradicts_data", "legend_or_units"}
            and s["subtype"] in {"point", "compare", "max", "unit"}
        ]
    need_bad = n_stmt - n_corr
    if len(follows) < n_corr or len(bad) < need_bad:
        return None
    corr = _pick(follows, n_corr, rng, "subtype")
    inc = _pick(bad, need_bad, rng, "error_type")
    if not corr or not inc:
        return None
    if len({s["error_type"] for s in inc}) < 2:
        return None
    if diff == 2 and not any(s["subtype"] in {"monotonic_up", "monotonic_down", "arithmetic", "zone", "series", "depend", "identity", "spread", "all", "compare"} for s in corr):
        return None
    if diff == 3 and not any(
        s["error_type"] in {"not_in_data", "causation", "absolute_claim", "not_monotonic", "extrapolation"}
        for s in inc
    ):
        return None
    if diff == 3 and not any(s["difficulty"] >= 2 for s in corr):
        return None
    chosen = corr + inc
    ids = {id(s) for s in chosen}
    if len(ids) != len(chosen):
        return None
    rng.shuffle(chosen)
    for prev in existing:
        if len(set(s["stmt_id"] for s in chosen) & set(prev["stmt_ids"])) >= 4:
            return None
    answer = "".join(str(i) for i, s in enumerate(chosen, 1) if s["verdict"] == "follows")
    if len(answer) != n_corr or answer != "".join(sorted(answer)):
        return None
    recomputed = _recompute(ds, chosen)
    if recomputed != answer:
        return None
    difficulty = diff
    return {
        "difficulty": difficulty,
        "n_correct": n_corr,
        "statements": chosen,
        "stmt_ids": [s["stmt_id"] for s in chosen],
        "answer": answer,
    }


def _pick(cands: list[dict], k: int, rng: random.Random, key: str) -> list[dict] | None:
    local = cands[:]
    rng.shuffle(local)
    chosen = []
    used = set()
    for item in local:
        marker = item[key]
        if marker in used:
            continue
        chosen.append(item)
        used.add(marker)
        if len(chosen) == k:
            return chosen
    for item in local:
        if item in chosen:
            continue
        chosen.append(item)
        if len(chosen) == k:
            return chosen
    return None


def _recompute(ds: dict, statements: list[dict]) -> str:
    nums = []
    for i, stmt in enumerate(statements, 1):
        got = evaluate(ds, stmt["predicate"])
        if stmt["verdict"] == "follows" and got is not True:
            return ""
        if stmt["verdict"] == "contradicts" and got is not False:
            return ""
        if stmt["verdict"] == "not_in_data" and got is not None:
            return ""
        if got is True:
            nums.append(str(i))
    return "".join(nums)


def render_stem(ds: dict, statements: list[dict], table: str | None) -> str:
    kind = "таблицу" if ds["form"] == "table" else "график"
    lines = [
        f"Проанализируйте {kind} «{ds['title']}».",
        f"{ds['source_note']} {ds['conditions']}",
        "Выберите утверждения, которые можно сформулировать на основании анализа представленных данных. "
        "Запишите в ответе цифры, под которыми указаны выбранные утверждения.",
        EXAM_NOTE,
    ]
    if table:
        lines.append(table)
    for i, stmt in enumerate(statements, 1):
        lines.append(f"{i}) {stmt['text']}")
    lines.append("Ответ: ___________________________.")
    return "\n\n".join(lines)


def render_solution(ds: dict, statements: list[dict], answer: str) -> str:
    kind = "В таблице" if ds["form"] == "table" else "На графике"
    parts = [
        f"{kind} «{ds['title']}» приведены условные данные. {ds['conditions']}",
    ]
    correct_nums = []
    for i, stmt in enumerate(statements, 1):
        if stmt["verdict"] == "follows":
            mark = "следует из данных"
            correct_nums.append(i)
        elif stmt["verdict"] == "contradicts":
            mark = "противоречит данным"
        else:
            mark = "из представленных данных не следует"
        parts.append(f"{i}) {mark}. {stmt['explain']}")
    parts.append(
        f"Верные утверждения: {ru_and(correct_nums)}. "
        f"В бланк их записывают по возрастанию, без пробелов и запятых: {answer}."
    )
    parts.append(
        "Спецификация 2027 года для линии 21 не оговаривает, что порядок цифр не важен: "
        "задание засчитывается, только если запись полностью совпадает с эталоном. "
        "На экзамене надёжнее писать цифры по возрастанию."
    )
    return " ".join(p if p.endswith(".") else p for p in parts)


def finalize_question(ds: dict, draft: dict, number: int, table_html: str | None) -> dict:
    statements = []
    for stmt in draft["statements"]:
        statements.append(
            {
                "stmt_id": stmt["stmt_id"],
                "text": stmt["text"],
                "verdict": stmt["verdict"],
                "error_type": stmt["error_type"],
                "subtype": stmt["subtype"],
                "checks": stmt["checks"],
                "predicate": stmt["predicate"],
            }
        )
    qid = f"L21-{number:04d}"
    figure = "" if ds["form"] == "table" else f"figures/{ds['dataset_id']}.png"
    tags = [
        "линия-21",
        ds["block_title"],
        ds["form"],
        ds["code"],
        f"верных-{draft['n_correct']}",
        f"сложность-{draft['difficulty']}",
    ]
    tags += sorted({s["error_type"] for s in statements if s["error_type"]})
    if any(s["subtype"] == "design" for s in statements):
        tags.append("методы-1.3")
    return {
        "id": qid,
        "form": ds["form"],
        "topic": ds["topic"],
        "subtopic": ds["subtopic"],
        "codifier_section": ds["codifier_section"],
        "codifier_code": ds["code"],
        "block": ds["block"],
        "block_title": ds["block_title"],
        "difficulty": draft["difficulty"],
        "template_id": f"T-{ds['form']}-{draft['n_correct']}-{len(statements)}",
        "params": {
            "dataset_id": ds["dataset_id"],
            "stmt_ids": draft["stmt_ids"],
            "n_correct": draft["n_correct"],
        },
        "figure_id": ds["dataset_id"] if figure else "",
        "figure_file": figure,
        "data": _payload(ds),
        "statements": statements,
        "stem": render_stem(ds, draft["statements"], table_html if ds["form"] == "table" else None),
        "answer": draft["answer"],
        "answer_unit": "последовательность цифр",
        "solution": render_solution(ds, draft["statements"], draft["answer"]),
        "tags": tags,
        "dataset_id": ds["dataset_id"],
        "title": ds["title"],
    }


def _payload(ds: dict) -> dict:
    payload = {
        "layout": ds["layout"],
        "design": ds["design"],
        "iv": ds.get("iv"),
        "dv": ds.get("dv"),
        "y_unit": ds.get("y_unit"),
        "x": ds.get("x"),
        "series": [
            {"name": s["name"], "y": s["y"], **({"spread": s["spread"]} if s.get("spread") is not None else {})}
            for s in ds.get("series", [])
        ],
    }
    if ds["layout"] == "zone":
        payload["zone"] = ds["zone"]
        payload["clear_points"] = ds["clear_points"]
    if ds["layout"] == "matrix":
        payload["matrix"] = ds["matrix"]
    if ds["layout"] == "points":
        payload["points"] = ds["points"]
    return payload


def cap_title_sentence(text: str) -> str:
    return cap(text)
