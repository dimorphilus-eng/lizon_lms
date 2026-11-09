"use client";

import { useT } from "@/lib/i18n";

export interface PlayQuestion {
  id: string;
  type: string;
  prompt: string;
  widget: string;
  presentation?: "select" | "drag";
  payload: Record<string, unknown>;
  response?: unknown;
  revealed?: boolean;
  feedback?: string | null;
  score?: number | null;
  maxMark?: number;
  solution?: { summary?: string } | null;
  locked?: boolean;
  needsManual?: boolean;
}

export function QuestionView({ question, value, onChange }: { question: PlayQuestion; value: unknown; onChange: (value: unknown) => void }) {
  const { t } = useT();
  const disabled = Boolean(question.locked || question.revealed);
  return (
    <article className="stack">
      <div className="spread">
        <span className="badge">{question.type}</span>
        {question.maxMark !== undefined && <span className="muted">{question.maxMark}</span>}
      </div>
      <h2 style={{ fontFamily: "var(--serif)", margin: 0 }}>{question.prompt}</h2>
      <Widget question={question} value={value} onChange={onChange} disabled={disabled} />
      {question.revealed && question.feedback && <p className="muted">{question.feedback}</p>}
      {question.revealed && question.solution?.summary && <p><strong>{t("Ответ", "Answer")}: </strong>{question.solution.summary}</p>}
      {question.needsManual && question.score == null && <p className="muted">{t("Ждёт проверки преподавателя.", "Waiting for the teacher.")}</p>}
    </article>
  );
}

function Widget({ question, value, onChange, disabled }: { question: PlayQuestion; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const { t } = useT();
  const payload = question.payload;
  if (question.widget === "info") return <p>{String(payload.text ?? "")}</p>;
  if (question.widget === "choices") return <Choices payload={payload} value={value} onChange={onChange} disabled={disabled} />;
  if (question.widget === "boolean") {
    const current = (value as { value?: boolean } | undefined)?.value;
    return (
      <div className="row">
        {[true, false].map((item) => (
          <button key={String(item)} className={current === item ? "primary" : "ghost"} disabled={disabled} onClick={() => onChange({ value: item })} type="button">
            {item ? t("Верно", "True") : t("Неверно", "False")}
          </button>
        ))}
      </div>
    );
  }
  if (question.widget === "text" || question.widget === "essay" || question.widget === "number") {
    const text = (value as { text?: string; value?: string } | undefined)?.text ?? (value as { value?: string } | undefined)?.value ?? "";
    if (question.widget === "essay") {
      return <textarea disabled={disabled} value={text} onChange={(event) => onChange({ text: event.target.value })} />;
    }
    return (
      <input
        disabled={disabled}
        value={text}
        onChange={(event) => onChange(question.widget === "number" ? { value: event.target.value } : { text: event.target.value })}
        inputMode={question.widget === "number" ? "decimal" : "text"}
      />
    );
  }
  if (question.widget === "scale") {
    const min = Number(payload.min ?? 1);
    const max = Number(payload.max ?? 5);
    const current = Number((value as { value?: number } | undefined)?.value ?? min);
    return <input type="range" min={min} max={max} step={Number(payload.step ?? 1)} value={current} disabled={disabled} onChange={(event) => onChange({ value: Number(event.target.value) })} />;
  }
  if (question.widget === "match") return <Match payload={payload} value={value} onChange={onChange} disabled={disabled} drag={question.presentation === "drag"} />;
  if (question.widget === "order") return <Order payload={payload} value={value} onChange={onChange} disabled={disabled} />;
  if (question.widget === "gaps" || question.widget === "cloze") return <Gaps question={question} value={value} onChange={onChange} disabled={disabled} />;
  if (question.widget === "hotspot") return <Hotspot payload={payload} value={value} onChange={onChange} disabled={disabled} />;
  if (question.widget === "imageDrop") return <ImageDrop payload={payload} value={value} onChange={onChange} disabled={disabled} />;
  return <p className="muted">{t("Этот виджет пока не поддержан.", "This widget is not supported yet.")}</p>;
}

function Choices({ payload, value, onChange, disabled }: { payload: Record<string, unknown>; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const choices = (payload.choices as { id: string; text: string }[]) ?? [];
  const single = payload.single !== false;
  const selected = new Set(((value as { choiceIds?: string[] } | undefined)?.choiceIds) ?? []);
  const toggle = (id: string) => {
    if (single) onChange({ choiceIds: [id] });
    else {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange({ choiceIds: [...next] });
    }
  };
  return (
    <div className="stack">
      {choices.map((choice) => (
        <label key={choice.id} className="row">
          <input type={single ? "radio" : "checkbox"} checked={selected.has(choice.id)} disabled={disabled} onChange={() => toggle(choice.id)} />
          {choice.text}
        </label>
      ))}
    </div>
  );
}

function Match({ payload, value, onChange, disabled, drag }: { payload: Record<string, unknown>; value: unknown; onChange: (value: unknown) => void; disabled: boolean; drag: boolean }) {
  const stems = (payload.stems as { id: string; text: string }[]) ?? [];
  const options = (payload.options as { id: string; text: string }[]) ?? [];
  const pairs = ((value as { pairs?: { stemId: string; optionId: string }[] } | undefined)?.pairs) ?? [];
  const selected = new Map(pairs.map((pair) => [pair.stemId, pair.optionId]));
  const setPair = (stemId: string, optionId: string) => {
    const next = pairs.filter((pair) => pair.stemId !== stemId);
    if (optionId) next.push({ stemId, optionId });
    onChange({ pairs: next });
  };
  return (
    <div className="stack">
      {drag && <p className="muted">Drag a card onto a row, or use the list.</p>}
      {stems.map((stem) => (
        <div key={stem.id} className="row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => setPair(stem.id, event.dataTransfer.getData("text/plain"))}>
          <strong style={{ minWidth: 140 }}>{stem.text}</strong>
          <select disabled={disabled} value={selected.get(stem.id) ?? ""} onChange={(event) => setPair(stem.id, event.target.value)}>
            <option value="">—</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}
          </select>
        </div>
      ))}
      {drag && (
        <div className="row">
          {options.map((option) => (
            <span key={option.id} className="badge" draggable={!disabled} onDragStart={(event) => event.dataTransfer.setData("text/plain", option.id)}>{option.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Order({ payload, value, onChange, disabled }: { payload: Record<string, unknown>; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const initial = (payload.items as { id: string; text: string }[]) ?? [];
  const stored = (value as { order?: string[] } | undefined)?.order;
  const order = stored ?? initial.map((item) => item.id);
  const byId = new Map(initial.map((item) => [item.id, item.text]));
  const move = (index: number, direction: number) => {
    const next = order.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ order: next });
  };
  return (
    <div className="stack">
      {order.map((id, index) => (
        <div key={id} className="spread card" draggable={!disabled} onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          const from = Number(event.dataTransfer.getData("text/plain"));
          const next = order.slice();
          const [item] = next.splice(from, 1);
          next.splice(index, 0, item);
          onChange({ order: next });
        }}>
          <span>{byId.get(id)}</span>
          <span className="row">
            <button className="ghost" type="button" disabled={disabled} onClick={() => move(index, -1)}>↑</button>
            <button className="ghost" type="button" disabled={disabled} onClick={() => move(index, 1)}>↓</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function Gaps({ question, value, onChange, disabled }: { question: PlayQuestion; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const template = String(question.payload.template ?? "");
  const cloze = question.widget === "cloze";
  const gaps = (question.payload.gaps as { id: string; kind?: string; choices?: { id: string; text: string }[]; choiceIds?: string[] }[]) ?? [];
  const pool = (question.payload.pool as { id: string; text: string }[]) ?? [];
  const current = new Map(((value as { gaps?: { id?: string; gapId?: string; value?: string; optionId?: string }[] } | undefined)?.gaps ?? []).map((gap) => [gap.id || gap.gapId, gap.value || gap.optionId || ""]));
  const parts = template.split(/(\[\[[^\]]+\]\])/g);
  const update = (id: string, nextValue: string) => {
    const gapsValue = gaps.map((gap) => ({ id: gap.id, gapId: gap.id, value: gap.id === id ? nextValue : current.get(gap.id) ?? "", optionId: gap.id === id ? nextValue : current.get(gap.id) ?? "" }));
    onChange({ gaps: gapsValue });
  };
  return (
    <p>
      {parts.map((part, index) => {
        const match = part.match(/^\[\[(.+)\]\]$/);
        if (!match) return <span key={index}>{part}</span>;
        const gap = gaps.find((item) => item.id === match[1]);
        if (!gap) return <span key={index}>{part}</span>;
        if (cloze && gap.kind !== "choice") {
          return <input key={gap.id} style={{ width: 120 }} disabled={disabled} value={current.get(gap.id) ?? ""} onChange={(event) => update(gap.id, event.target.value)} />;
        }
        const choices = gap.choices ?? pool.filter((option) => !gap.choiceIds || gap.choiceIds.includes(option.id));
        return (
          <select key={gap.id} disabled={disabled} value={current.get(gap.id) ?? ""} onChange={(event) => update(gap.id, event.target.value)}>
            <option value="">—</option>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.text}</option>)}
          </select>
        );
      })}
    </p>
  );
}

function Hotspot({ payload, value, onChange, disabled }: { payload: Record<string, unknown>; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const points = ((value as { points?: { x: number; y: number }[] } | undefined)?.points) ?? [];
  return (
    <div className="hotspot" onClick={(event) => {
      if (disabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const point = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
      onChange({ points: payload.multiple ? [...points, point] : [point] });
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={String(payload.imageUrl)} alt="" />
      {points.map((point, index) => <span key={index} className="mark" style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
    </div>
  );
}

function ImageDrop({ payload, value, onChange, disabled }: { payload: Record<string, unknown>; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const drops = (payload.drops as { id: string; x: number; y: number; w: number; h: number; label?: string }[]) ?? [];
  const drags = (payload.drags as { id: string; text: string }[]) ?? [];
  const placements = ((value as { placements?: { dragId: string; dropId: string }[] } | undefined)?.placements) ?? [];
  const place = (dragId: string, dropId: string) => {
    const next = placements.filter((item) => item.dragId !== dragId);
    if (dropId) next.push({ dragId, dropId });
    onChange({ placements: next });
  };
  return (
    <div className="stack">
      <div className="hotspot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={String(payload.imageUrl)} alt="" />
        {drops.map((drop) => (
          <div key={drop.id} className="drop-zone" style={{ left: `${drop.x}%`, top: `${drop.y}%`, width: `${drop.w}%`, height: `${drop.h}%` }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => place(event.dataTransfer.getData("text/plain"), drop.id)}>
            {drop.label}
          </div>
        ))}
      </div>
      {drags.map((drag) => (
        <label key={drag.id} className="row" draggable={!disabled} onDragStart={(event) => event.dataTransfer.setData("text/plain", drag.id)}>
          {drag.text}
          <select disabled={disabled} value={placements.find((item) => item.dragId === drag.id)?.dropId ?? ""} onChange={(event) => place(drag.id, event.target.value)}>
            <option value="">—</option>
            {drops.map((drop) => <option key={drop.id} value={drop.id}>{drop.label || drop.id}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
