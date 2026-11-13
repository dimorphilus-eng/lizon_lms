"use client";

import { videoEmbed } from "@lizon/shared";
import { useEffect, useMemo, useState } from "react";
import { Markdown } from "./markdown";
import { QuestionView, type PlayQuestion } from "./question-view";
import { ApiError, api, uploadFile } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { can, useSession } from "@/lib/session";

interface ActivityPayload {
  activity: { id: string; title: string; type: string; content: Lesson | null; locked?: boolean; lockReason?: string; courseId: string; dueAt?: string | null };
  quiz: { id: string; timeLimitSec: number | null; attemptsAllowed: number; feedbackMode: string; questionsPerPage: number; passFraction: number } | null;
  assignment: { id: string; instructions: string; maxMark: number; maxFiles: number } | null;
}

interface Lesson {
  format?: string;
  body?: string;
  videoUrl?: string;
  link?: string;
  blocks?: { id: string; type: string; text?: string; title?: string; simulation?: string; cards?: { id: string; front: string; back: string }[]; questions?: { id: string; text: string; widget?: string; payload?: Record<string, unknown>; type: string }[] }[];
}

export function ActivityPlayer({ courseId, activityId }: { courseId: string; activityId: string }) {
  const { t } = useT();
  const { actor } = useSession();
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<ActivityPayload>(`/api/activities/${activityId}`).then(setData).catch((reason) => setError(reason.message));
  }, [activityId]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">{t("Загрузка…", "Loading…")}</p>;
  if (data.activity.locked) return <article className="card"><h1 className="page-title">{data.activity.title}</h1><p>{data.activity.lockReason}</p></article>;
  return (
    <article className="stack">
      <h1 className="page-title">{data.activity.title}</h1>
      {data.activity.type === "quiz" && data.quiz && <QuizPlayer quiz={data.quiz} />}
      {data.activity.type === "assignment" && data.assignment && <AssignmentBox assignment={data.assignment} teacher={can(actor, "assignments.grade")} />}
      {data.activity.type !== "quiz" && data.activity.type !== "assignment" && <LessonBody activityId={activityId} lesson={data.activity.content} />}
      {(data.activity.type === "forum" || data.activity.type === "lesson") && <Discussion activityId={activityId} />}
      <p><a href={`/learn/courses/${courseId}`}>{t("К содержанию", "Back to the outline")}</a></p>
    </article>
  );
}

function LessonBody({ activityId, lesson }: { activityId: string; lesson: Lesson | null }) {
  const { t } = useT();
  const video = videoEmbed(lesson?.videoUrl);
  return (
    <div className="stack">
      {lesson?.body && <Markdown text={lesson.body} />}
      {video?.kind === "file" && <video className="video" controls src={video.src} />}
      {video && video.kind !== "file" && <iframe className="frame" src={video.src} title="video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />}
      {lesson?.link && <p><a href={lesson.link}>{lesson.link}</a></p>}
      {lesson?.blocks?.map((block) => {
        if (block.type === "cards") return <Cards key={block.id} cards={block.cards ?? []} />;
        if (block.type === "simulation") return <Simulation key={block.id} kind={block.simulation || "line"} title={block.title} />;
        if (block.type === "quiz") return <Practice key={block.id} activityId={activityId} blockId={block.id} questions={block.questions ?? []} />;
        if (block.type === "markdown" && block.text) return <Markdown key={block.id} text={block.text} />;
        return null;
      })}
      <button className="ghost" type="button" onClick={() => api(`/api/activities/${activityId}/complete`, { method: "POST" }).catch(() => undefined)}>{t("Отметить пройденным", "Mark complete")}</button>
    </div>
  );
}

function Cards({ cards }: { cards: { id: string; front: string; back: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid cards">
      {cards.map((card) => (
        <div key={card.id} className="flip">
          <button type="button" onClick={() => setOpen(open === card.id ? null : card.id)}>
            <strong>{open === card.id ? card.back : card.front}</strong>
          </button>
        </div>
      ))}
    </div>
  );
}

function Simulation({ kind, title }: { kind: string; title?: string }) {
  const [r, setR] = useState(0.45);
  const [k, setK] = useState(100);
  const [n0, setN0] = useState(6);
  const [slope, setSlope] = useState(1);
  const [intercept, setIntercept] = useState(0);
  const points = useMemo(() => {
    if (kind === "line") return Array.from({ length: 21 }, (_, i) => slope * (i - 10) + intercept);
    return Array.from({ length: 36 }, (_, t) => k / (1 + (k / Math.max(n0, 0.1) - 1) * Math.exp(-r * t)));
  }, [kind, r, k, n0, slope, intercept]);
  const max = Math.max(...points, 1);
  const d = points.map((value, index) => `${(index / (points.length - 1)) * 300},${160 - (value / max) * 140}`).join(" ");
  return (
    <section className="card sim">
      <h3>{title}</h3>
      {kind === "line" ? (
        <div className="row">
          <label>a <input type="range" min={-3} max={3} step={0.1} value={slope} onChange={(event) => setSlope(Number(event.target.value))} /></label>
          <label>b <input type="range" min={-40} max={40} step={1} value={intercept} onChange={(event) => setIntercept(Number(event.target.value))} /></label>
        </div>
      ) : (
        <div className="row">
          <label>r <input type="range" min={0.05} max={1.2} step={0.05} value={r} onChange={(event) => setR(Number(event.target.value))} /></label>
          <label>K <input type="range" min={20} max={200} value={k} onChange={(event) => setK(Number(event.target.value))} /></label>
          <label>N0 <input type="range" min={1} max={40} value={n0} onChange={(event) => setN0(Number(event.target.value))} /></label>
        </div>
      )}
      <svg viewBox="0 0 300 180"><polyline fill="none" stroke="currentColor" strokeWidth="2" points={d} /></svg>
    </section>
  );
}

function Practice({ activityId, blockId, questions }: { activityId: string; blockId: string; questions: { id: string; text: string; widget?: string; payload?: Record<string, unknown>; type: string }[] }) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<unknown>({});
  const [feedback, setFeedback] = useState("");
  const question = questions[index];
  if (!question) return null;
  const play: PlayQuestion = { id: question.id, type: question.type, prompt: question.text, widget: question.widget || "text", payload: question.payload || {} };
  return (
    <section className="card">
      <QuestionView question={play} value={value} onChange={setValue} />
      <div className="row">
        <button className="primary" type="button" onClick={() => api<{ feedback?: string }>(`/api/activities/${activityId}/practice`, { method: "POST", body: JSON.stringify({ blockId, questionId: question.id, response: value }) }).then((result) => setFeedback(result.feedback || "")).catch((reason: ApiError) => setFeedback(reason.message))}>{t("Проверить", "Check")}</button>
        {index < questions.length - 1 && <button className="ghost" type="button" onClick={() => { setIndex(index + 1); setValue({}); setFeedback(""); }}>{t("Дальше", "Next")}</button>}
      </div>
      {feedback && <p>{feedback}</p>}
    </section>
  );
}

function QuizPlayer({ quiz }: { quiz: ActivityPayload["quiz"] }) {
  const { t } = useT();
  const [attempt, setAttempt] = useState<{ id: string; state: string; expiresAt: string | null; score: number | null; maxScore: number | null; questions: PlayQuestion[]; questionsPerPage?: number } | null>(null);
  const [page, setPage] = useState(0);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!quiz) return null;
  const start = () => api<NonNullable<typeof attempt>>(`/api/quizzes/${quiz.id}/attempts`, { method: "POST" }).then((next) => {
    setAttempt(next);
    const initial: Record<string, unknown> = {};
    for (const question of next.questions) if (question.response) initial[question.id] = question.response;
    setResponses(initial);
  }).catch((reason: ApiError) => setError(reason.message));
  const save = async (submit = false) => {
    if (!attempt) return;
    const answers = Object.entries(responses).map(([id, response]) => ({ id, response }));
    const saved = await api<NonNullable<typeof attempt>>(`/api/attempts/${attempt.id}/answers`, { method: "PUT", body: JSON.stringify({ answers }) });
    const finalAttempt = submit ? await api<NonNullable<typeof attempt>>(`/api/attempts/${attempt.id}/submit`, { method: "POST" }) : saved;
    setAttempt(finalAttempt);
  };
  if (!attempt) {
    return (
      <section className="card">
        <p>{t("Режим обратной связи", "Feedback")}: {quiz.feedbackMode}. {quiz.timeLimitSec ? `${Math.round(quiz.timeLimitSec / 60)} ${t("мин", "min")}` : t("Без таймера", "No timer")}.</p>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="button" onClick={start}>{t("Начать попытку", "Start attempt")}</button>
      </section>
    );
  }
  const size = attempt.questionsPerPage || quiz.questionsPerPage || 1;
  const slice = attempt.questions.slice(page * size, page * size + size);
  const left = attempt.expiresAt ? Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - now) / 1000)) : null;
  return (
    <section className="stack">
      <div className="spread">
        <span className="badge">{attempt.state}</span>
        {left !== null && <span>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}
        {attempt.score != null && <span>{attempt.score} / {attempt.maxScore}</span>}
      </div>
      {slice.map((question) => (
        <div key={question.id} className="card">
          <QuestionView question={{ ...question, response: responses[question.id] ?? question.response }} value={responses[question.id] ?? question.response} onChange={(value) => setResponses((current) => ({ ...current, [question.id]: value }))} />
        </div>
      ))}
      {attempt.state === "inprogress" && (
        <div className="row">
          <button className="ghost" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Назад", "Back")}</button>
          {page * size + size < attempt.questions.length && <button className="ghost" type="button" onClick={() => save(false).then(() => setPage(page + 1))}>{t("Дальше", "Next")}</button>}
          <button className="ghost" type="button" onClick={() => save(false)}>{t("Сохранить", "Save")}</button>
          <button className="primary" type="button" onClick={() => save(true)}>{t("Сдать", "Submit")}</button>
        </div>
      )}
    </section>
  );
}

function AssignmentBox({ assignment, teacher }: { assignment: NonNullable<ActivityPayload["assignment"]>; teacher: boolean }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<{ id: string; text: string; score: number | null; feedback: string; status: string; user?: { firstName: string; lastName: string } }[]>([]);
  const [message, setMessage] = useState("");
  const load = () => api<typeof submissions>(`/api/assignments/${assignment.id}/submissions`).then(setSubmissions).catch(() => undefined);
  useEffect(() => { void load(); }, [assignment.id]);
  return (
    <section className="stack">
      <Markdown text={assignment.instructions} />
      <p className="muted">{t("Максимум", "Maximum")} {assignment.maxMark}</p>
      <form className="card" onSubmit={(event) => {
          event.preventDefault();
          api(`/api/assignments/${assignment.id}/submissions`, { method: "POST", body: JSON.stringify({ text, fileIds }) }).then(() => { setMessage(t("Отправлено", "Submitted")); setText(""); void load(); }).catch((reason: ApiError) => setMessage(reason.message));
        }}>
          <textarea value={text} onChange={(event) => setText(event.target.value)} />
          <input type="file" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const saved = await uploadFile(file);
            setFileIds((current) => [...current, saved.id]);
          }} />
          <button className="primary" type="submit">{t("Сдать задание", "Submit assignment")}</button>
          {message && <p>{message}</p>}
      </form>
      {submissions.map((submission) => (
        <article key={submission.id} className="card">
          <p>{submission.user ? `${submission.user.firstName} ${submission.user.lastName}` : t("Ваша работа", "Your work")}</p>
          <p>{submission.text}</p>
          <p className="muted">{submission.status} {submission.score ?? "—"} / {assignment.maxMark}</p>
          {submission.feedback && <p>{submission.feedback}</p>}
          {teacher && submission.status !== "graded" && <GradeForm submissionId={submission.id} onDone={load} />}
        </article>
      ))}
    </section>
  );
}

function GradeForm({ submissionId, onDone }: { submissionId: string; onDone: () => void }) {
  const { t } = useT();
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState("");
  return (
    <form className="row" onSubmit={(event) => {
      event.preventDefault();
      void api(`/api/submissions/${submissionId}/grade`, { method: "POST", body: JSON.stringify({ score, feedback }) }).then(onDone);
    }}>
      <input type="number" value={score} onChange={(event) => setScore(Number(event.target.value))} />
      <input value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={t("Комментарий", "Comment")} />
      <button className="primary" type="submit">{t("Оценить", "Grade")}</button>
    </form>
  );
}

function Discussion({ activityId }: { activityId: string }) {
  const { t } = useT();
  const [posts, setPosts] = useState<{ id: string; body: string; parentId: string | null; author: { firstName: string; lastName: string } }[]>([]);
  const [body, setBody] = useState("");
  const [parentId, setParentId] = useState<string | undefined>();
  const load = () => api<{ posts: typeof posts }>(`/api/activities/${activityId}/posts`).then((result) => setPosts(result.posts));
  useEffect(() => { void load(); }, [activityId]);
  return (
    <section className="card stack">
      <h3>{t("Обсуждение", "Discussion")}</h3>
      {posts.map((post) => (
        <div key={post.id}>
          <strong>{post.author.firstName} {post.author.lastName}</strong>
          <p>{post.body}</p>
          <button className="tiny" type="button" onClick={() => setParentId(post.id)}>{t("Ответить", "Reply")}</button>
        </div>
      ))}
      <form onSubmit={(event) => { event.preventDefault(); void api(`/api/activities/${activityId}/posts`, { method: "POST", body: JSON.stringify({ body, parentId }) }).then(() => { setBody(""); setParentId(undefined); void load(); }); }}>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} />
        <button className="primary" type="submit">{t("Отправить", "Send")}</button>
      </form>
    </section>
  );
}
