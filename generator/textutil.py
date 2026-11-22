"""Форматирование чисел и коротких русских связок."""

from __future__ import annotations


def fmt_num(v) -> str:
    if isinstance(v, str):
        return v
    fv = float(v)
    if abs(fv - round(fv)) < 1e-9:
        return str(int(round(fv)))
    s = f"{fv:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def cap(s: str) -> str:
    if not s:
        return s
    return s[0].upper() + s[1:]


def ru_and(nums: list[int]) -> str:
    parts = [str(n) for n in nums]
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} и {parts[1]}"
    return ", ".join(parts[:-1]) + " и " + parts[-1]


def ensure_sentence(text: str) -> str:
    text = " ".join(text.split())
    if not text.endswith("."):
        text += "."
    return cap(text)
