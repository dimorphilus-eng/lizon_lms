"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

interface Dashboard {
  courses: { id: string; title: string; progress: number; courseGrade: number | null; continueId: string | null }[];
  deadlines: { id: string; courseId: string; title: string; dueAt: string }[];
  certificates: number;
  unread: number;
}

export default function LearnPage() {
  const { t } = useT();
  const { actor } = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Dashboard>("/api/dashboard/student").then(setData).catch((reason) => setError(reason.message));
  }, []);
  return (
    <section>
      <h1 className="page-title">{actor ? `${actor.firstName}` : t("Учёба", "Learn")}</h1>
      <p className="lede">{t("Курсы, ближайшие сроки и непрочитанное.", "Courses, upcoming deadlines and unread notes.")}</p>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">{t("Загрузка…", "Loading…")}</p>}
      {data && data.courses.length === 0 && <p className="muted">{t("Пока нет курсов. Запишитесь из каталога или попросите преподавателя.", "No courses yet. Enrol from the catalogue or ask a teacher.")}</p>}
      <div className="grid cards">
        {data?.courses.map((course) => (
          <Link key={course.id} href={`/learn/courses/${course.id}`} className="card" style={{ textDecoration: "none" }}>
            <h3>{course.title}</h3>
            <div className="progress" aria-label={t("Прогресс", "Progress")}><span style={{ width: `${Math.round(course.progress * 100)}%` }} /></div>
            <p className="muted">{Math.round(course.progress * 100)}%{course.courseGrade != null ? ` · ${Math.round(course.courseGrade * 100)}%` : ""}</p>
          </Link>
        ))}
        <article className="card">
          <h3>{t("Рядом", "Nearby")}</h3>
          <p>{t("Сертификаты", "Certificates")}: {data?.certificates ?? "—"}</p>
          <p>{t("Непрочитанные", "Unread")}: {data?.unread ?? "—"}</p>
          <ul>
            {data?.deadlines.map((item) => (
              <li key={item.id}><Link href={`/learn/courses/${item.courseId}/a/${item.id}`}>{item.title}</Link> · {new Date(item.dueAt).toLocaleDateString()}</li>
            ))}
            {data && data.deadlines.length === 0 && <li className="muted">{t("Ближайших сроков нет.", "No deadlines nearby.")}</li>}
          </ul>
        </article>
      </div>
      {data && <Catalog enrolled={data.courses.map((course) => course.id)} />}
    </section>
  );
}

function Catalog({ enrolled }: { enrolled: string[] }) {
  const { t } = useT();
  const [courses, setCourses] = useState<{ id: string; title: string; summary: string }[]>([]);
  useEffect(() => { api<{ id: string; title: string; summary: string }[]>("/api/courses?scope=catalog").then(setCourses).catch(() => undefined); }, []);
  const open = courses.filter((course) => !enrolled.includes(course.id));
  if (!open.length) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <h2>{t("Каталог", "Catalogue")}</h2>
      <div className="stack">
        {open.map((course) => (
          <div key={course.id} className="card spread">
            <div><strong>{course.title}</strong><p className="muted">{course.summary}</p></div>
            <button className="primary" type="button" onClick={() => api(`/api/courses/${course.id}/enrollments`, { method: "POST", body: "{}" }).then(() => location.reload())}>{t("Записаться", "Enrol")}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
