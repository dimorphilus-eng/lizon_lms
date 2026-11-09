"use client";

import { emptyDefinition, explainValidation, validateDefinition, QuestionValidationError, SCALE_PLUGIN, registerQuestionPlugin } from "@lizon/shared";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

try { registerQuestionPlugin(SCALE_PLUGIN); } catch { /* already registered on the server bundle or a reload */ }

export function QuestionForm({ initial, onSubmit }: { initial?: { type: string; name: string; text: string; definition: unknown; penalty?: number }; onSubmit: (value: { type: string; name: string; text: string; definition: unknown; penalty: number }) => Promise<void> }) {
  const { t, locale } = useT();
  const [type, setType] = useState(initial?.type || "multichoice");
  const [name, setName] = useState(initial?.name || "");
  const [text, setText] = useState(initial?.text || "");
  const [penalty, setPenalty] = useState(initial?.penalty || 0);
  const [definition, setDefinition] = useState<unknown>(initial?.definition || emptyDefinition("multichoice"));
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!initial) setDefinition(emptyDefinition(type));
  }, [type, initial]);
  const friendly = ["multichoice", "truefalse", "shortanswer", "numerical", "essay", "matching", "ordering", "description", "scale"].includes(type);
  return (
    <form className="stack" onSubmit={async (event) => {
      event.preventDefault();
      const next = friendly ? definition : JSON.parse(raw || JSON.stringify(definition));
      try {
        validateDefinition(type, next);
        await onSubmit({ type, name, text, definition: next, penalty });
        setError("");
      } catch (reason) {
        const code = reason instanceof QuestionValidationError ? reason.code : reason instanceof Error ? reason.message : "definition_invalid";
        setError(explainValidation(code, locale === "en" ? "en" : "ru"));
      }
    }}>
      <label className="field"><span>{t("Тип", "Type")}</span>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {["multichoice", "truefalse", "shortanswer", "numerical", "essay", "matching", "ddmatch", "ddtext", "ddimage", "ordering", "description", "cloze", "calculated", "calculatedmc", "hotspot", "gapselect", "scale"].map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="field"><span>{t("Название", "Name")}</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label className="field"><span>{t("Формулировка", "Prompt")}</span><textarea value={text} onChange={(event) => setText(event.target.value)} required /></label>
      <label className="field"><span>{t("Штраф за ошибку в адаптивном режиме", "Penalty per wrong try")}</span><input type="number" step="0.01" min="0" max="1" value={penalty} onChange={(event) => setPenalty(Number(event.target.value))} /></label>
      {type === "multichoice" && <MultiEditor definition={definition} onChange={setDefinition} />}
      {type === "truefalse" && <label className="row"><input type="checkbox" checked={Boolean((definition as { correct?: boolean }).correct)} onChange={(event) => setDefinition({ correct: event.target.checked })} />{t("Верно — правильный ответ", "True is correct")}</label>}
      {type === "shortanswer" && <ShortEditor definition={definition} onChange={setDefinition} />}
      {type === "numerical" && <NumEditor definition={definition} onChange={setDefinition} />}
      {type === "essay" && <label className="field"><span>{t("Минимум слов", "Minimum words")}</span><input type="number" value={(definition as { minWords?: number }).minWords || 0} onChange={(event) => setDefinition({ minWords: Number(event.target.value) })} /></label>}
      {type === "matching" && <MatchEditor definition={definition} onChange={setDefinition} />}
      {type === "ordering" && <OrderEditor definition={definition} onChange={setDefinition} />}
      {type === "description" && <p className="muted">{t("Информационный блок без балла.", "Information block, no score.")}</p>}
      {type === "scale" && <ScaleEditor definition={definition} onChange={setDefinition} />}
      {!friendly && (
        <label className="field"><span>JSON</span><textarea value={raw || JSON.stringify(definition, null, 2)} onChange={(event) => setRaw(event.target.value)} /></label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit">{t("Сохранить вопрос", "Save question")}</button>
    </form>
  );
}

function MultiEditor({ definition, onChange }: { definition: unknown; onChange: (value: unknown) => void }) {
  const data = definition as { single?: boolean; choices?: { id: string; text: string; fraction: number }[] };
  const choices = data.choices || [];
  const update = (next: typeof choices) => onChange({ ...data, choices: next });
  return (
    <div className="stack">
      <label className="row"><input type="checkbox" checked={data.single !== false} onChange={(event) => onChange({ ...data, single: event.target.checked })} />single</label>
      {choices.map((choice, index) => (
        <div key={choice.id} className="row">
          <input value={choice.text} onChange={(event) => update(choices.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />
          <input type="number" step="0.1" value={choice.fraction} onChange={(event) => update(choices.map((item, i) => i === index ? { ...item, fraction: Number(event.target.value) } : item))} />
        </div>
      ))}
      <button className="ghost" type="button" onClick={() => update([...choices, { id: `c${choices.length + 1}`, text: "", fraction: 0 }])}>+</button>
    </div>
  );
}

function ShortEditor({ definition, onChange }: { definition: unknown; onChange: (value: unknown) => void }) {
  const data = definition as { caseSensitive?: boolean; answers?: { text: string; fraction: number }[] };
  const answers = data.answers || [];
  return (
    <div>
      <label className="row"><input type="checkbox" checked={Boolean(data.caseSensitive)} onChange={(event) => onChange({ ...data, caseSensitive: event.target.checked })} />Aa</label>
      {answers.map((answer, index) => (
        <div key={index} className="row">
          <input value={answer.text} onChange={(event) => onChange({ ...data, answers: answers.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} />
          <input type="number" step="0.1" value={answer.fraction} onChange={(event) => onChange({ ...data, answers: answers.map((item, i) => i === index ? { ...item, fraction: Number(event.target.value) } : item) })} />
        </div>
      ))}
    </div>
  );
}

function NumEditor({ definition, onChange }: { definition: unknown; onChange: (value: unknown) => void }) {
  const data = definition as { answers?: { value: number; tolerance: number; toleranceType: string; fraction: number }[] };
  const answer = data.answers?.[0] || { value: 0, tolerance: 0, toleranceType: "absolute", fraction: 1 };
  return (
    <div className="row">
      <input type="number" value={answer.value} onChange={(event) => onChange({ answers: [{ ...answer, value: Number(event.target.value) }] })} />
      <input type="number" value={answer.tolerance} onChange={(event) => onChange({ answers: [{ ...answer, tolerance: Number(event.target.value) }] })} />
      <select value={answer.toleranceType} onChange={(event) => onChange({ answers: [{ ...answer, toleranceType: event.target.value }] })}>
        <option value="absolute">absolute</option>
        <option value="relative">relative</option>
      </select>
    </div>
  );
}

function MatchEditor({ definition, onChange }: { definition: unknown; onChange: (value: unknown) => void }) {
  const data = definition as { pairs?: { id: string; stem: string; answer: string }[]; distractors?: string[] };
  const pairs = data.pairs || [];
  return (
    <div className="stack">
      {pairs.map((pair, index) => (
        <div key={pair.id} className="row">
          <input value={pair.stem} onChange={(event) => onChange({ ...data, pairs: pairs.map((item, i) => i === index ? { ...item, stem: event.target.value } : item) })} />
          <input value={pair.answer} onChange={(event) => onChange({ ...data, pairs: pairs.map((item, i) => i === index ? { ...item, answer: event.target.value } : item) })} />
        </div>
      ))}
    </div>
  );
}

function OrderEditor({ definition, onChange }: { definition: unknown; onChange: (value: unknown) => void }) {
  const items = (definition as { items?: { id: string; text: string }[] }).items || [];
  return (
    <div className="stack">
      {items.map((item, index) => (
        <input key={item.id} value={item.text} onChange={(event) => onChange({ items: items.map((row, i) => i === index ? { ...row, text: event.target.value } : row) })} />
      ))}
      <button className="ghost" type="button" onClick={() => onChange({ items: [...items, { id: `i${items.length + 1}`, text: "" }] })}>+</button>
    </div>
  );
}

function ScaleEditor({ definition, onChange }: { definition: unknown; onChange: (value: unknown) => void }) {
  const data = definition as { min?: number; max?: number; correct?: number };
  return (
    <div className="row">
      <input type="number" value={data.min ?? 1} onChange={(event) => onChange({ ...data, min: Number(event.target.value) })} />
      <input type="number" value={data.max ?? 5} onChange={(event) => onChange({ ...data, max: Number(event.target.value) })} />
    </div>
  );
}
