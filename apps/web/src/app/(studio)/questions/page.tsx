"use client";

import { useEffect, useState } from "react";
import { QuestionForm } from "@/components/question-form";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { RequirePermission } from "@/lib/session";

interface Question {
  id: string;
  type: string;
  name: string;
  text: string;
  definition: unknown;
  penalty: number;
  categoryId: string;
}

export default function QuestionsPage() {
  const { t } = useT();
  const [categories, setCategories] = useState<{ id: string; name: string; courseId: string | null }[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api<{ items: Question[] }>(`/api/questions?take=100${categoryId ? `&categoryId=${categoryId}` : ""}${type ? `&type=${type}` : ""}`).then((data) => setQuestions(data.items));
  useEffect(() => { api<typeof categories>("/api/question-categories").then((rows) => { setCategories(rows); if (!categoryId && rows[0]) setCategoryId(rows[0].id); }); }, []);
  useEffect(() => { if (categoryId) void load(); }, [categoryId, type]);
  return (
    <RequirePermission anyOf={["questions.manage"]}>
    <section className="split">
      <div>
        <h1 className="page-title">{t("Банк вопросов", "Question bank")}</h1>
        <div className="row">
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select value={type} onChange={(event) => setType(event.target.value)}><option value="">{t("Все типы", "All types")}</option>{["multichoice", "truefalse", "shortanswer", "numerical", "essay", "matching", "cloze", "calculated", "hotspot", "scale"].map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {questions.map((question) => <article key={question.id} className="card"><span className="badge">{question.type}</span><h3>{question.name}</h3><p className="muted">{question.text}</p></article>)}
          {questions.length === 0 && <p className="muted">{t("В этой категории пусто.", "This category is empty.")}</p>}
        </div>
      </div>
      <div className="card">
        <h3>{t("Новый вопрос", "New question")}</h3>
        {categoryId && <QuestionForm onSubmit={async (value) => {
          await api("/api/questions", { method: "POST", body: JSON.stringify({ ...value, categoryId }) });
          setMessage(t("Вопрос сохранён", "Question saved"));
          await load();
        }} />}
        {message && <p>{message}</p>}
        <button className="ghost" type="button" onClick={() => api<{ payload: string }>("/api/questions/export", { method: "POST", body: JSON.stringify({ categoryId, format: "moodle-xml" }) }).then((data) => {
          const blob = new Blob([data.payload], { type: "application/xml" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "questions.xml";
          link.click();
        })}>{t("Экспорт Moodle XML", "Export Moodle XML")}</button>
      </div>
    </section>
    </RequirePermission>
  );
}
