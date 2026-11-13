"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { RequirePermission } from "@/lib/session";

export default function TeachPage() {
  const { t } = useT();
  const router = useRouter();
  const [courses, setCourses] = useState<{ id: string; title: string; status: string; learners?: number; averageProgress?: number }[]>([]);
  const [title, setTitle] = useState("");
  useEffect(() => {
    api<{ courses: typeof courses }>("/api/dashboard/teacher").then((data) => setCourses(data.courses)).catch(() => undefined);
  }, []);
  return (
    <RequirePermission anyOf={["content.author", "courses.create"]}>
    <section>
      <h1 className="page-title">{t("Преподавание", "Teaching")}</h1>
      <form className="row" onSubmit={(event) => {
        event.preventDefault();
        void api<{ id: string }>("/api/courses", { method: "POST", body: JSON.stringify({ title, enrollmentMode: "open" }) }).then((course) => router.push(`/teach/courses/${course.id}`));
      }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("Название нового курса", "New course title")} required />
        <button className="primary" type="submit">{t("Создать", "Create")}</button>
      </form>
      <div className="grid cards" style={{ marginTop: 16 }}>
        {courses.map((course) => (
          <Link key={course.id} href={`/teach/courses/${course.id}`} className="card" style={{ textDecoration: "none" }}>
            <h3>{course.title}</h3>
            <p className="muted">{course.status} · {course.learners ?? 0} · {Math.round((course.averageProgress || 0) * 100)}%</p>
          </Link>
        ))}
        {courses.length === 0 && <p className="muted">{t("Курсов пока нет.", "No courses yet.")}</p>}
      </div>
    </section>
    </RequirePermission>
  );
}
