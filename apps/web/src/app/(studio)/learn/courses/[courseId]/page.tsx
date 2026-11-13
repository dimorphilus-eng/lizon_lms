"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Outline {
  course: { title: string; summary: string; passingGrade: number };
  enrollment: { progress: number; courseGrade: number | null; role: string } | null;
  modules: { id: string; title: string; summary: string; locked: boolean; lockReason: string | null; activities: { id: string; title: string; type: string; locked: boolean; lockReason: string | null; completed: boolean; dueAt: string | null }[] }[];
}

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t } = useT();
  const [data, setData] = useState<Outline | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Outline>(`/api/courses/${courseId}/outline`).then(setData).catch((reason) => setError(reason.message));
  }, [courseId]);
  const reason = (code: string | null) => {
    if (code === "requires_completion") return t("Сначала завершите предыдущий шаг", "Finish the previous step first");
    if (code === "requires_grade") return t("Нужна оценка выше порога", "A higher grade is required");
    if (code === "requires_group") return t("Только для вашей группы", "Only your group");
    if (code === "not_yet_open") return t("Ещё не открыто", "Not open yet");
    if (code === "closed") return t("Закрыто", "Closed");
    return code;
  };
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">{t("Загрузка…", "Loading…")}</p>;
  return (
    <section>
      <h1 className="page-title">{data.course.title}</h1>
      <p className="lede">{data.course.summary}</p>
      {data.enrollment && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="progress"><span style={{ width: `${Math.round(data.enrollment.progress * 100)}%` }} /></div>
          <p className="muted">{t("Прогресс", "Progress")} {Math.round(data.enrollment.progress * 100)}% · {t("порог", "pass mark")} {Math.round(data.course.passingGrade * 100)}%</p>
        </div>
      )}
      <div className="stack">
        {data.modules.map((module) => (
          <section key={module.id} className={module.locked ? "card locked" : "card"}>
            <h3>{module.title}</h3>
            {module.summary && <p className="muted">{module.summary}</p>}
            {module.locked && <p>{reason(module.lockReason)}</p>}
            <div className="stack">
              {module.activities.map((activity) => activity.locked || module.locked ? (
                <div key={activity.id} className="spread locked"><span>{activity.title}</span><span className="badge">{reason(activity.lockReason || module.lockReason)}</span></div>
              ) : (
                <Link key={activity.id} href={`/learn/courses/${courseId}/a/${activity.id}`} className="spread">
                  <span>{activity.title}</span>
                  <span className="badge">{activity.completed ? t("готово", "done") : activity.type}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
