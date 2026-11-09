"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { RequirePermission } from "@/lib/session";

interface Outline {
  course: { id: string; title: string; summary: string; status: string; enrollmentMode: string };
  modules: { id: string; title: string; activities: { id: string; title: string; type: string }[] }[];
}

export default function TeachCoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t } = useT();
  const [data, setData] = useState<Outline | null>(null);
  const [moduleTitle, setModuleTitle] = useState("");
  const [activity, setActivity] = useState({ moduleId: "", type: "lesson", title: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const load = () => api<Outline>(`/api/courses/${courseId}/outline`).then(setData);
  useEffect(() => { void load(); }, [courseId]);
  if (!data) return <RequirePermission anyOf={["content.author", "courses.create"]}><p className="muted">{t("Загрузка…", "Loading…")}</p></RequirePermission>;
  return (
    <RequirePermission anyOf={["content.author", "courses.create"]}>
    <section className="split">
      <div className="stack">
        <h1 className="page-title" style={{ fontSize: 36 }}>{data.course.title}</h1>
        <p className="badge">{data.course.status}</p>
        <button className="ghost" type="button" onClick={() => api(`/api/courses/${courseId}`, { method: "PATCH", body: JSON.stringify({ status: data.course.status === "published" ? "draft" : "published" }) }).then(load)}>{data.course.status === "published" ? t("Снять с публикации", "Unpublish") : t("Опубликовать", "Publish")}</button>
        <form onSubmit={(event) => { event.preventDefault(); void api(`/api/courses/${courseId}/modules`, { method: "POST", body: JSON.stringify({ title: moduleTitle }) }).then(() => { setModuleTitle(""); void load(); }); }}>
          <input value={moduleTitle} onChange={(event) => setModuleTitle(event.target.value)} placeholder={t("Новый модуль", "New module")} />
        </form>
        {data.modules.map((module) => (
          <section key={module.id} className="card">
            <h3>{module.title}</h3>
            {module.activities.map((item) => (
              <button key={item.id} className="ghost" type="button" onClick={() => setSelected(item.id)}>{item.type}: {item.title}</button>
            ))}
            <form className="row" onSubmit={(event) => { event.preventDefault(); void api(`/api/modules/${module.id}/activities`, { method: "POST", body: JSON.stringify({ type: activity.type, title: activity.title }) }).then(() => { setActivity({ ...activity, title: "" }); void load(); }); }}>
              <select value={activity.type} onChange={(event) => setActivity({ ...activity, type: event.target.value })}>
                {["lesson", "quiz", "assignment", "forum", "resource", "interactive"].map((type) => <option key={type}>{type}</option>)}
              </select>
              <input value={activity.moduleId === module.id ? activity.title : ""} onChange={(event) => setActivity({ moduleId: module.id, type: activity.type, title: event.target.value })} placeholder={t("Активность", "Activity")} />
              <button className="tiny" type="submit">+</button>
            </form>
          </section>
        ))}
      </div>
      <div>{selected && <ActivityEditor id={selected} courseId={courseId} onChange={load} />}</div>
    </section>
    </RequirePermission>
  );
}

function ActivityEditor({ id, courseId, onChange }: { id: string; courseId: string; onChange: () => void }) {
  const { t } = useT();
  const [payload, setPayload] = useState<{ activity: { title: string; type: string; content: { body?: string; videoUrl?: string; format?: string; blocks?: unknown[] } | null }; quiz: { id: string; slots?: { questionId: string | null; maxMark: number; randomRule: unknown }[] } | null } | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [questions, setQuestions] = useState<{ id: string; name: string }[]>([]);
  const [questionId, setQuestionId] = useState("");
  useEffect(() => {
    api<typeof payload>(`/api/activities/${id}`).then((data) => {
      setPayload(data);
      setTitle(data?.activity.title || "");
      setBody(data?.activity.content?.body || "");
      setVideoUrl(data?.activity.content?.videoUrl || "");
    });
    api<{ items: { id: string; name: string }[] }>(`/api/questions?courseId=${courseId}&take=100`).then((data) => setQuestions(data.items)).catch(() => undefined);
  }, [id, courseId]);
  if (!payload) return null;
  const save = () => api(`/api/activities/${id}`, { method: "PATCH", body: JSON.stringify({ title, content: { ...(payload.activity.content || {}), format: "markdown", body, videoUrl } }) }).then(onChange);
  return (
    <div className="card stack">
      <h3>{payload.activity.type}</h3>
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      <input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https:// video" />
      <button className="primary" type="button" onClick={save}>{t("Сохранить версию", "Save version")}</button>
      {payload.quiz && (
        <form className="row" onSubmit={(event) => {
          event.preventDefault();
          const kept = (payload.quiz?.slots ?? []).map((slot) => ({ questionId: slot.questionId, maxMark: slot.maxMark, randomRule: slot.randomRule }));
          void api(`/api/activities/${id}/quiz`, { method: "PUT", body: JSON.stringify({ slots: [...kept, { questionId, maxMark: 1 }] }) }).then(() => { setQuestionId(""); void api<typeof payload>(`/api/activities/${id}`).then(setPayload); });
        }}>
          <select value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
            <option value="">{t("Добавить вопрос из банка", "Add a bank question")}</option>
            {questions.map((question) => <option key={question.id} value={question.id}>{question.name}</option>)}
          </select>
          <button className="tiny" type="submit">+</button>
        </form>
      )}
      <p className="muted">{t("Вопрос добавляется к текущим слотам.", "The question is appended to the current slots.")} {payload.quiz?.slots?.length ?? 0}</p>
    </div>
  );
}
