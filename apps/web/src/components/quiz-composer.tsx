"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface RandomRule {
  categoryId?: string;
  tags?: string[];
  types?: string[];
  count?: number;
}

interface SlotDraft {
  questionId: string | null;
  name: string;
  type: string;
  maxMark: number;
  randomRule: RandomRule | null;
}

interface QuizSettings {
  timeLimitSec: number | null;
  attemptsAllowed: number;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  feedbackMode: string;
  gradeMethod: string;
  questionsPerPage: number;
  passFraction: number;
}

interface QuizPayload {
  id: string;
  timeLimitSec: number | null;
  attemptsAllowed: number;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  feedbackMode: string;
  gradeMethod: string;
  questionsPerPage: number;
  passFraction: number;
  slots?: { questionId: string | null; maxMark: number; randomRule: RandomRule | null; question?: { id: string; name: string; type: string } | null }[];
}

const QUESTION_TYPES = ["multichoice", "truefalse", "shortanswer", "numerical", "essay", "matching", "ordering", "cloze", "calculated", "hotspot", "gapselect"];

export function QuizComposer({ activityId, courseId, onCourseChange }: { activityId: string; courseId: string; onCourseChange: () => void }) {
  const { t } = useT();
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [settings, setSettings] = useState<QuizSettings | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [bank, setBank] = useState<{ id: string; name: string; type: string; tags: string[] }[]>([]);
  const [questionId, setQuestionId] = useState("");
  const [query, setQuery] = useState("");
  const [rule, setRule] = useState({ categoryId: "", tags: "", types: [] as string[], count: 1, maxMark: 1 });
  const [pool, setPool] = useState<number | null>(null);
  const [variants, setVariants] = useState({ count: 2, title: "", distinct: true });
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ name: string; type: string; source: string }[]>([]);
  const [built, setBuilt] = useState<{ title: string; questions: { name: string; type: string }[] }[]>([]);

  const load = () => api<{ activity: { title: string }; quiz: QuizPayload | null }>(`/api/activities/${activityId}`).then((data) => {
    const quiz = data.quiz;
    if (!quiz) return;
    setVariants((current) => ({ ...current, title: data.activity.title }));
    setSettings({
      timeLimitSec: quiz.timeLimitSec,
      attemptsAllowed: quiz.attemptsAllowed,
      shuffleQuestions: quiz.shuffleQuestions,
      shuffleAnswers: quiz.shuffleAnswers,
      feedbackMode: quiz.feedbackMode,
      gradeMethod: quiz.gradeMethod,
      questionsPerPage: quiz.questionsPerPage,
      passFraction: quiz.passFraction,
    });
    setSlots((quiz.slots ?? []).map((slot) => ({
      questionId: slot.questionId,
      name: slot.question?.name || "",
      type: slot.question?.type || "",
      maxMark: slot.maxMark,
      randomRule: slot.questionId ? null : slot.randomRule,
    })));
  });

  useEffect(() => { void load(); }, [activityId]);
  useEffect(() => {
    api<{ id: string; name: string }[]>(`/api/question-categories?courseId=${courseId}`).then((rows) => {
      setCategories(rows);
      setRule((current) => ({ ...current, categoryId: current.categoryId || rows[0]?.id || "" }));
    }).catch(() => undefined);
    api<{ items: { id: string; name: string; type: string; tags: string[] }[] }>(`/api/questions?courseId=${courseId}&take=100`).then((data) => setBank(data.items)).catch(() => undefined);
  }, [courseId]);

  useEffect(() => {
    if (!rule.categoryId) return;
    const tags = rule.tags.split(",").map((item) => item.trim()).filter(Boolean);
    api<{ total: number }>("/api/question-pool", { method: "POST", body: JSON.stringify({ categoryId: rule.categoryId, tags, types: rule.types, courseId }) })
      .then((result) => setPool(result.total))
      .catch(() => setPool(null));
  }, [rule.categoryId, rule.tags, rule.types, courseId]);

  const persist = async (next: SlotDraft[]) => {
    await api(`/api/activities/${activityId}/quiz`, {
      method: "PUT",
      body: JSON.stringify({
        slots: next.map((slot) => ({
          questionId: slot.questionId,
          maxMark: slot.maxMark,
          randomRule: slot.randomRule,
        })),
      }),
    });
    setSlots(next);
  };

  const categoryName = (id?: string) => categories.find((category) => category.id === id)?.name || t("любая категория курса", "any course category");
  const visibleBank = bank.filter((question) => !query || `${question.name} ${question.type} ${question.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="stack">
      <section className="card stack">
        <h3>{t("Состав теста", "Quiz contents")}</h3>
        <p className="muted">{t("Фиксированный вопрос один и тот же у всех. Случайный вопрос, как в Moodle, заново берётся из банка на каждую попытку.", "A fixed question is the same for everyone. A random question, as in Moodle, is drawn from the bank on every attempt.")}</p>
        {slots.length === 0 && <p className="muted">{t("В тесте пока нет слотов.", "This quiz has no slots yet.")}</p>}
        {slots.map((slot, index) => (
          <div key={`${slot.questionId || "random"}-${index}`} className="spread">
            <div>
              {slot.questionId ? (
                <><span className="badge">{slot.type}</span> {slot.name}</>
              ) : (
                <><span className="badge">{t("случайный", "random")}</span> {slot.randomRule?.count || 1} · {categoryName(slot.randomRule?.categoryId)}{slot.randomRule?.tags?.length ? ` · ${slot.randomRule.tags.join(", ")}` : ""}{slot.randomRule?.types?.length ? ` · ${slot.randomRule.types.join(", ")}` : ""}</>
              )}
              <span className="muted"> · {slot.maxMark}</span>
            </div>
            <span className="row">
              <button className="tiny" type="button" disabled={index === 0} onClick={() => { const next = slots.slice(); [next[index - 1], next[index]] = [next[index], next[index - 1]]; void persist(next); }}>{t("Выше", "Up")}</button>
              <button className="tiny" type="button" disabled={index === slots.length - 1} onClick={() => { const next = slots.slice(); [next[index + 1], next[index]] = [next[index], next[index + 1]]; void persist(next); }}>{t("Ниже", "Down")}</button>
              <button className="tiny" type="button" onClick={() => void persist(slots.filter((_, item) => item !== index))}>{t("Убрать", "Remove")}</button>
            </span>
          </div>
        ))}
        <div className="row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Найти в банке", "Search the bank")} />
          <select value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
            <option value="">{t("Вопрос из банка", "Question from the bank")}</option>
            {visibleBank.map((question) => <option key={question.id} value={question.id}>{question.type}: {question.name}</option>)}
          </select>
          <button className="tiny" type="button" disabled={!questionId} onClick={() => {
            const question = bank.find((item) => item.id === questionId);
            if (!question) return;
            void persist([...slots, { questionId: question.id, name: question.name, type: question.type, maxMark: 1, randomRule: null }]).then(() => setQuestionId(""));
          }}>{t("Добавить", "Add")}</button>
        </div>
      </section>

      <section className="card stack">
        <h3>{t("Случайный вопрос", "Random question")}</h3>
        <label className="field"><span>{t("Категория", "Category")}</span>
          <select value={rule.categoryId} onChange={(event) => setRule({ ...rule, categoryId: event.target.value })}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{t("Теги через запятую, достаточно любого", "Tags, comma-separated; any one matches")}</span>
          <input value={rule.tags} onChange={(event) => setRule({ ...rule, tags: event.target.value })} placeholder="pool" />
        </label>
        <label className="field"><span>{t("Типы, можно несколько", "Types, any number")}</span>
          <select multiple size={6} value={rule.types} onChange={(event) => setRule({ ...rule, types: [...event.target.selectedOptions].map((option) => option.value) })}>
            {QUESTION_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <div className="row">
          <label className="field"><span>{t("Сколько взять", "How many")}</span><input type="number" min={1} max={50} value={rule.count} onChange={(event) => setRule({ ...rule, count: Number(event.target.value) })} /></label>
          <label className="field"><span>{t("Балл за каждый", "Mark each")}</span><input type="number" min={0} step={0.5} value={rule.maxMark} onChange={(event) => setRule({ ...rule, maxMark: Number(event.target.value) })} /></label>
        </div>
        <p className="muted">{pool === null ? "" : t(`В банке подходит: ${pool}`, `Matching questions: ${pool}`)}</p>
        <button className="primary" type="button" disabled={!rule.categoryId || rule.count < 1} onClick={() => {
          const tags = rule.tags.split(",").map((item) => item.trim()).filter(Boolean);
          void persist([...slots, { questionId: null, name: "", type: "", maxMark: rule.maxMark, randomRule: { categoryId: rule.categoryId, tags, types: rule.types, count: rule.count } }]);
        }}>{t("Добавить случайный слот", "Add a random slot")}</button>
      </section>

      {settings && (
        <section className="card stack">
          <h3>{t("Правила попытки", "Attempt rules")}</h3>
          <div className="row">
            <label className="field"><span>{t("Минуты, 0 — без таймера", "Minutes, 0 means no timer")}</span><input type="number" min={0} value={settings.timeLimitSec ? Math.round(settings.timeLimitSec / 60) : 0} onChange={(event) => setSettings({ ...settings, timeLimitSec: Number(event.target.value) ? Number(event.target.value) * 60 : null })} /></label>
            <label className="field"><span>{t("Попытки, 0 — без лимита", "Attempts, 0 means unlimited")}</span><input type="number" min={0} value={settings.attemptsAllowed} onChange={(event) => setSettings({ ...settings, attemptsAllowed: Number(event.target.value) })} /></label>
            <label className="field"><span>{t("Вопросов на странице", "Questions per page")}</span><input type="number" min={1} value={settings.questionsPerPage} onChange={(event) => setSettings({ ...settings, questionsPerPage: Number(event.target.value) })} /></label>
          </div>
          <div className="row">
            <label className="field"><span>{t("Обратная связь", "Feedback")}</span>
              <select value={settings.feedbackMode} onChange={(event) => setSettings({ ...settings, feedbackMode: event.target.value })}>
                <option value="immediate">immediate</option>
                <option value="deferred">deferred</option>
                <option value="closed">closed</option>
                <option value="adaptive">adaptive</option>
              </select>
            </label>
            <label className="field"><span>{t("Оценка за попытки", "Grade from attempts")}</span>
              <select value={settings.gradeMethod} onChange={(event) => setSettings({ ...settings, gradeMethod: event.target.value })}>
                <option value="highest">highest</option>
                <option value="average">average</option>
                <option value="first">first</option>
                <option value="last">last</option>
              </select>
            </label>
          </div>
          <label className="row"><input type="checkbox" checked={settings.shuffleQuestions} onChange={(event) => setSettings({ ...settings, shuffleQuestions: event.target.checked })} />{t("Перемешивать вопросы", "Shuffle questions")}</label>
          <label className="row"><input type="checkbox" checked={settings.shuffleAnswers} onChange={(event) => setSettings({ ...settings, shuffleAnswers: event.target.checked })} />{t("Перемешивать ответы", "Shuffle answers")}</label>
          <button className="ghost" type="button" onClick={() => api(`/api/activities/${activityId}/quiz`, { method: "PUT", body: JSON.stringify({ settings }) }).then(() => setMessage(t("Правила сохранены", "Rules saved")))}>{t("Сохранить правила", "Save rules")}</button>
        </section>
      )}

      <section className="card stack">
        <h3>{t("Варианты экзамена", "Exam variants")}</h3>
        <p className="muted">{t("Каждый вариант — отдельный тест в этом модуле. Случайные слоты разыгрываются один раз и закрепляются, чтобы работу можно было открыть и выдать.", "Each variant is its own quiz in this module. Random slots are drawn once and frozen, so the paper can be opened and handed out.")}</p>
        <div className="row">
          <label className="field"><span>{t("Сколько вариантов", "How many variants")}</span><input type="number" min={1} max={20} value={variants.count} onChange={(event) => setVariants({ ...variants, count: Number(event.target.value) })} /></label>
          <label className="field"><span>{t("Название вариантов", "Variant title")}</span><input value={variants.title} onChange={(event) => setVariants({ ...variants, title: event.target.value })} /></label>
        </div>
        <label className="row"><input type="checkbox" checked={variants.distinct} onChange={(event) => setVariants({ ...variants, distinct: event.target.checked })} />{t("Не повторять случайные вопросы между вариантами", "Do not repeat random questions across variants")}</label>
        <div className="row">
          <button className="ghost" type="button" onClick={() => api<{ questions: { name: string; type: string; source: string }[]; warnings: string[] }>(`/api/activities/${activityId}/quiz/preview`, { method: "POST" }).then((result) => { setPreview(result.questions); setMessage(result.warnings.join(" ")); }).catch((reason: ApiError) => setMessage(reason.message))}>{t("Показать один розыгрыш", "Show one draw")}</button>
          <button className="primary" type="button" onClick={() => api<{ variants: { title: string; questions: { name: string; type: string }[] }[]; warnings: string[] }>(`/api/activities/${activityId}/quiz/variants`, { method: "POST", body: JSON.stringify({ count: variants.count, title: variants.title || undefined, distinct: variants.distinct }) }).then((result) => { setBuilt(result.variants); setMessage(result.warnings.join(" ") || t(`Собрано вариантов: ${result.variants.length}`, `Variants built: ${result.variants.length}`)); onCourseChange(); }).catch((reason: ApiError) => setMessage(reason.message))}>{t("Собрать варианты", "Build variants")}</button>
        </div>
        {message && <p>{message}</p>}
        {preview.length > 0 && (
          <ul>{preview.map((question, index) => <li key={`${question.name}-${index}`}>{question.source === "random" ? t("случайный", "random") : t("фиксированный", "fixed")}: {question.type} · {question.name}</li>)}</ul>
        )}
        {built.map((variant) => (
          <article key={variant.title}>
            <strong>{variant.title}</strong>
            <ul>{variant.questions.map((question, index) => <li key={`${question.name}-${index}`}>{question.type}: {question.name}</li>)}</ul>
          </article>
        ))}
      </section>
    </div>
  );
}
