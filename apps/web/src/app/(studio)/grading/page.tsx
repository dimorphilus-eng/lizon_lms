"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { RequirePermission } from "@/lib/session";

interface Item {
  id: string;
  prompt: string;
  response: { text?: string } | null;
  maxMark: number;
  attempt: { id: string; user: { firstName: string; lastName: string }; quiz: { activity: { title: string } } };
}

export default function GradingPage() {
  const { t } = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const load = () => api<Item[]>("/api/grading/queue").then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);
  return (
    <RequirePermission anyOf={["quizzes.grade", "assignments.grade"]}>
    <section>
      <h1 className="page-title">{t("Проверка", "Grading")}</h1>
      {items.length === 0 && <p className="muted">{t("Открытых ответов нет.", "Nothing is waiting.")}</p>}
      <div className="stack">
        {items.map((item) => (
          <article key={item.id} className="card">
            <p className="muted">{item.attempt.user.firstName} {item.attempt.user.lastName} · {item.attempt.quiz.activity.title}</p>
            <h3>{item.prompt}</h3>
            <p>{item.response?.text}</p>
            <form className="row" onSubmit={(event) => {
              event.preventDefault();
              void api(`/api/attempts/${item.attempt.id}/grade`, { method: "POST", body: JSON.stringify({ questionId: item.id, score: scores[item.id] ?? item.maxMark, comment: comments[item.id] || "" }) }).then(load);
            }}>
              <input type="number" min={0} max={item.maxMark} value={scores[item.id] ?? item.maxMark} onChange={(event) => setScores({ ...scores, [item.id]: Number(event.target.value) })} />
              <input value={comments[item.id] || ""} onChange={(event) => setComments({ ...comments, [item.id]: event.target.value })} placeholder={t("Комментарий", "Comment")} />
              <button className="primary" type="submit">{t("Поставить", "Save mark")}</button>
            </form>
          </article>
        ))}
      </div>
    </section>
    </RequirePermission>
  );
}
