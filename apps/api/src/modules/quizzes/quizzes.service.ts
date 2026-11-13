import { BadRequestException, Injectable } from "@nestjs/common";
import {
  getQuestionPlugin,
  gradeQuestion,
  instantiateText,
  materializeQuestion,
  presentQuestion,
  solveQuestion,
  type FeedbackMode,
} from "@lizon/shared";
import { Prisma } from "@prisma/client";
import type { AttemptQuestion, Quiz, QuizAttempt } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { hasPermission } from "../../common/actor";
import { tr } from "../../common/text";
import { PolicyService } from "../access/policy.service";
import { ProgressService } from "../access/progress.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CoursesService } from "../courses/courses.service";

interface RandomRule {
  categoryId?: string;
  tags?: string[];
  types?: string[];
  count?: number;
}

@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
    private readonly courses: CoursesService,
  ) {}

  async saveSettings(actor: Actor, activityId: string, input: { settings?: Record<string, unknown>; slots?: { questionId?: string | null; maxMark?: number; randomRule?: RandomRule | null }[] }) {
    const quiz = await this.quizByActivity(actor, activityId, true);
    const settings = input.settings ?? {};
    await this.prisma.quiz.update({
      where: { id: quiz.id },
      data: {
        timeLimitSec: settings.timeLimitSec === null ? null : typeof settings.timeLimitSec === "number" ? settings.timeLimitSec : undefined,
        attemptsAllowed: typeof settings.attemptsAllowed === "number" ? settings.attemptsAllowed : undefined,
        shuffleQuestions: typeof settings.shuffleQuestions === "boolean" ? settings.shuffleQuestions : undefined,
        shuffleAnswers: typeof settings.shuffleAnswers === "boolean" ? settings.shuffleAnswers : undefined,
        gradeMethod: typeof settings.gradeMethod === "string" ? settings.gradeMethod : undefined,
        feedbackMode: typeof settings.feedbackMode === "string" ? settings.feedbackMode : undefined,
        questionsPerPage: typeof settings.questionsPerPage === "number" ? settings.questionsPerPage : undefined,
        passFraction: typeof settings.passFraction === "number" ? settings.passFraction : undefined,
      },
    });
    if (input.slots) {
      await this.prisma.quizSlot.deleteMany({ where: { quizId: quiz.id } });
      await this.prisma.quizSlot.createMany({
        data: input.slots.map((slot, position) => ({
          quizId: quiz.id,
          position,
          questionId: slot.questionId ?? null,
          maxMark: slot.maxMark ?? 1,
          randomRule: slot.randomRule ? (slot.randomRule as Prisma.InputJsonValue) : Prisma.JsonNull,
        })),
      });
    }
    return this.prisma.quiz.findUnique({ where: { id: quiz.id }, include: { slots: { orderBy: { position: "asc" }, include: { question: true } } } });
  }

  async start(actor: Actor, quizId: string) {
    const quiz = await this.loadQuiz(quizId);
    await this.assertStudent(actor, quiz.activityId);
    const open = await this.prisma.quizAttempt.findFirst({ where: { quizId, userId: actor.id, state: "inprogress" }, include: { questions: true } });
    if (open) {
      if (this.expired(open, quiz)) return this.submit(actor, open.id);
      return this.present(actor, open.id);
    }
    const finished = await this.prisma.quizAttempt.count({ where: { quizId, userId: actor.id, state: { not: "inprogress" } } });
    if (quiz.attemptsAllowed > 0 && finished >= quiz.attemptsAllowed) {
      throw new BadRequestException({ message: tr(actor.locale, "Попытки закончились.", "No attempts left."), code: "attempts" });
    }
    const slots = quiz.shuffleQuestions ? shuffle(quiz.slots) : quiz.slots.slice();
    const create: Prisma.AttemptQuestionCreateWithoutAttemptInput[] = [];
    const used = new Set<string>();
    for (const slot of slots) {
      const questions = slot.question ? [slot.question] : await this.pickRandom(slot.randomRule as RandomRule | null, used, quiz.activity.courseId);
      for (const question of questions) {
        if (!question) continue;
        used.add(question.id);
        const plugin = getQuestionPlugin(question.type);
        const materialized = materializeQuestion(question.type, question.definition, { shuffle: quiz.shuffleAnswers });
        create.push({
          questionId: question.id,
          position: create.length,
          maxMark: plugin.graded ? slot.maxMark : 0,
          type: question.type,
          prompt: question.text,
          definition: materialized.definition as Prisma.InputJsonValue,
          dataset: materialized.dataset ? (materialized.dataset as Prisma.InputJsonValue) : Prisma.JsonNull,
        });
      }
    }
    if (!create.length) throw new BadRequestException({ message: tr(actor.locale, "В тесте нет вопросов.", "This quiz has no questions."), code: "empty_quiz" });
    const attempt = await this.prisma.quizAttempt.create({
      data: { quizId, userId: actor.id, attemptNumber: finished + 1, questions: { create } },
    });
    return this.present(actor, attempt.id);
  }

  /** Один розыгрыш слотов без записи попытки: фиксированные вопросы остаются, случайные берутся из банка. */
  async preview(actor: Actor, activityId: string) {
    const quiz = await this.quizForTeach(actor, activityId);
    return this.draw(quiz, new Set(), actor.locale === "en" ? "en" : "ru");
  }

  /**
   * Собирает несколько готовых работ. Случайный слот разыгрывается один раз и сохраняется
   * как обычный вопрос, чтобы вариант можно было просмотреть и выдать группе.
   * distinct не повторяет уже выпавшие случайные вопросы в следующих вариантах.
   */
  async buildVariants(actor: Actor, activityId: string, input: { count: number; title?: string; distinct?: boolean }) {
    const quiz = await this.quizForTeach(actor, activityId);
    const title = (input.title || quiz.activity.title).trim();
    const shared = new Set<string>();
    const warnings: string[] = [];
    const variants: { activityId: string; quizId: string; title: string; questions: { id: string; name: string; type: string; maxMark: number }[] }[] = [];
    for (let number = 1; number <= input.count; number++) {
      const drawn = await this.draw(quiz, input.distinct ? shared : new Set(), actor.locale === "en" ? "en" : "ru");
      warnings.push(...drawn.warnings.map((warning) => `${number}: ${warning}`));
      if (!drawn.questions.length) {
        warnings.push(tr(actor.locale, `${number}: в банке не осталось вопросов для варианта.`, `${number}: the bank has no questions left for this variant.`));
        continue;
      }
      if (input.distinct) {
        for (const question of drawn.questions) if (question.source === "random") shared.add(question.id);
      }
      const variantTitle = `${title} — ${tr(actor.locale, "вариант", "variant")} ${number}`;
      const created = await this.freezeVariant(quiz, variantTitle, drawn.questions);
      variants.push({ activityId: created.activityId, quizId: created.quizId, title: variantTitle, questions: drawn.questions.map(({ id, name, type, maxMark }) => ({ id, name, type, maxMark })) });
    }
    return { variants, warnings };
  }

  async poolSize(actor: Actor, input: RandomRule & { courseId?: string }) {
    if (!hasPermission(actor, "questions.manage") && !hasPermission(actor, "content.author")) this.policy.forbid(actor);
    const total = await this.prisma.question.count({ where: this.poolWhere(input, new Set(), input.courseId) });
    return { total };
  }

  async myAttempts(actor: Actor, quizId: string) {
    const quiz = await this.loadQuiz(quizId);
    const teacher = await this.isTeacher(actor, quiz.activity.courseId);
    return this.prisma.quizAttempt.findMany({
      where: { quizId, userId: teacher ? undefined : actor.id },
      orderBy: { attemptNumber: "desc" },
      include: teacher ? { user: true } : undefined,
    });
  }

  async present(actor: Actor, attemptId: string): Promise<unknown> {
    const attempt = await this.attemptFor(actor, attemptId);
    if (attempt.state === "inprogress" && this.expired(attempt, attempt.quiz)) return this.submit(actor, attemptId);
    return this.toClient(actor, attempt);
  }

  async saveAnswers(actor: Actor, attemptId: string, answers: { id: string; response: unknown }[]) {
    const attempt = await this.attemptFor(actor, attemptId);
    if (attempt.userId !== actor.id) this.policy.forbid(actor);
    if (attempt.state !== "inprogress") throw new BadRequestException({ message: tr(actor.locale, "Попытка уже сдана.", "This attempt is already submitted."), code: "closed" });
    if (this.expired(attempt, attempt.quiz)) return this.submit(actor, attemptId);
    const mode = attempt.quiz.feedbackMode as FeedbackMode;
    for (const answer of answers) {
      const question = attempt.questions.find((item) => item.id === answer.id);
      if (!question || question.locked) continue;
      if (mode === "immediate" || mode === "adaptive") {
        const result = gradeQuestion({
          type: question.type,
          definition: question.definition,
          response: answer.response,
          maxScore: question.maxMark,
          penalty: await this.penaltyOf(question.questionId),
          wrongTries: question.wrongTries,
          mode,
          dataset: this.dataset(question),
          locale: actor.locale === "en" ? "en" : "ru",
          finalized: false,
        });
        await this.prisma.attemptQuestion.update({
          where: { id: question.id },
          data: {
            response: answer.response as Prisma.InputJsonValue,
            score: result.needsManual ? null : result.score,
            needsManual: result.needsManual,
            feedback: result.feedback,
            detail: result.parts ? (result.parts as Prisma.InputJsonValue) : Prisma.JsonNull,
            wrongTries: result.wrongTries,
            locked: mode === "immediate" || result.locked,
            revealed: mode === "immediate" || result.locked,
          },
        });
      } else {
        await this.prisma.attemptQuestion.update({
          where: { id: question.id },
          data: { response: answer.response as Prisma.InputJsonValue },
        });
      }
    }
    return this.present(actor, attemptId);
  }

  async submit(actor: Actor, attemptId: string): Promise<unknown> {
    const attempt = await this.attemptFor(actor, attemptId);
    if (attempt.userId !== actor.id && !await this.isTeacher(actor, attempt.quiz.activity.courseId)) this.policy.forbid(actor);
    if (attempt.state !== "inprogress") return this.toClient(actor, attempt);
    const mode = attempt.quiz.feedbackMode as FeedbackMode;
    for (const question of attempt.questions) {
      if (question.locked && !question.needsManual) continue;
      const result = gradeQuestion({
        type: question.type,
        definition: question.definition,
        response: question.response,
        maxScore: question.maxMark,
        penalty: await this.penaltyOf(question.questionId),
        wrongTries: question.wrongTries,
        mode,
        dataset: this.dataset(question),
        locale: actor.locale === "en" ? "en" : "ru",
        finalized: true,
      });
      await this.prisma.attemptQuestion.update({
        where: { id: question.id },
        data: {
          score: result.needsManual ? null : result.score,
          needsManual: result.needsManual,
          feedback: result.feedback,
          detail: result.parts ? (result.parts as Prisma.InputJsonValue) : Prisma.JsonNull,
          wrongTries: result.wrongTries,
          locked: true,
          revealed: mode !== "closed",
        },
      });
    }
    const fresh = await this.attemptFor(actor, attemptId);
    const totals = this.totals(fresh.questions);
    const state = totals.pending ? "pending_review" : "graded";
    await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: { state, submittedAt: new Date(), score: totals.score, maxScore: totals.max },
    });
    await this.writeGradebook(fresh.quiz, attempt.userId);
    if (!totals.pending) {
      await this.notifications.notify(attempt.userId, "grade", {
        title: tr(actor.locale, `Результат: ${fresh.quiz.activity.title}`, `Result: ${fresh.quiz.activity.title}`),
        body: `${round(totals.score)} / ${round(totals.max)}`,
        link: `/learn/courses/${fresh.quiz.activity.courseId}/a/${fresh.quiz.activityId}`,
      });
    }
    return this.present(actor, attemptId);
  }

  async gradeManual(actor: Actor, attemptId: string, input: { questionId: string; score: number; comment?: string }) {
    const attempt = await this.attemptFor(actor, attemptId);
    if (!await this.isTeacher(actor, attempt.quiz.activity.courseId) && !hasPermission(actor, "quizzes.grade")) this.policy.forbid(actor);
    const question = attempt.questions.find((item) => item.id === input.questionId);
    if (!question) this.policy.missing(actor);
    const score = Math.max(0, Math.min(question.maxMark, input.score));
    await this.prisma.attemptQuestion.update({
      where: { id: question.id },
      data: { score, graderComment: input.comment ?? "", gradedById: actor.id, needsManual: true },
    });
    const fresh = await this.attemptFor(actor, attemptId);
    const totals = this.totals(fresh.questions);
    const state = totals.pending ? "pending_review" : "graded";
    await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: { state, score: totals.score, maxScore: totals.max },
    });
    await this.writeGradebook(fresh.quiz, fresh.userId);
    if (!totals.pending) {
      const student = await this.prisma.user.findUnique({ where: { id: fresh.userId } });
      await this.notifications.notify(fresh.userId, "grade", {
        title: student?.locale === "en" ? `Graded: ${fresh.quiz.activity.title}` : `Проверено: ${fresh.quiz.activity.title}`,
        body: `${round(totals.score)} / ${round(totals.max)}`,
        link: `/learn/courses/${fresh.quiz.activity.courseId}/a/${fresh.quiz.activityId}`,
      });
    }
    return this.present(actor, attemptId);
  }

  async queue(actor: Actor) {
    if (!hasPermission(actor, "quizzes.grade") && !hasPermission(actor, "assignments.grade") && !hasPermission(actor, "content.author")) {
      this.policy.forbid(actor);
    }
    const courseIds = await this.taughtCourseIds(actor);
    return this.prisma.attemptQuestion.findMany({
      where: {
        needsManual: true,
        score: null,
        attempt: { quiz: { activity: { courseId: courseIds ? { in: courseIds } : undefined } } },
      },
      include: { attempt: { include: { user: true, quiz: { include: { activity: true } } } } },
      orderBy: { attempt: { submittedAt: "asc" } },
      take: 100,
    });
  }

  private async writeGradebook(quiz: Quiz & { activity: { id: string; courseId: string; completion: unknown } }, userId: string) {
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { quizId: quiz.id, userId, state: { not: "inprogress" } },
      orderBy: { attemptNumber: "asc" },
    });
    if (!attempts.length) return;
    const fractionOf = (attempt: QuizAttempt) => (attempt.maxScore ? (attempt.score ?? 0) / attempt.maxScore : 0);
    let chosen = attempts[attempts.length - 1];
    let fraction = fractionOf(chosen);
    let pending = chosen.state === "pending_review";
    if (quiz.gradeMethod === "first") chosen = attempts[0];
    if (quiz.gradeMethod === "highest") chosen = attempts.reduce((best, attempt) => (fractionOf(attempt) > fractionOf(best) ? attempt : best));
    if (quiz.gradeMethod === "average") {
      fraction = attempts.reduce((sum, attempt) => sum + fractionOf(attempt), 0) / attempts.length;
      pending = attempts.some((attempt) => attempt.state === "pending_review");
      chosen = attempts[attempts.length - 1];
    } else {
      fraction = fractionOf(chosen);
      pending = chosen.state === "pending_review";
    }
    const maxScore = chosen.maxScore ?? 0;
    await this.progress.upsertGrade({
      userId,
      courseId: quiz.activity.courseId,
      activityId: quiz.activity.id,
      score: fraction * maxScore,
      maxScore,
      status: pending ? "pending" : "graded",
    });
    const activity = await this.prisma.activity.findUnique({ where: { id: quiz.activity.id } });
    if (!activity) return;
    const rule = this.progress.completionRule(activity);
    if (rule.type === "submit" || (rule.type === "pass" && !pending && fraction >= rule.minFraction)) {
      await this.progress.complete(userId, activity.id);
    }
  }

  private totals(questions: AttemptQuestion[]) {
    let score = 0;
    let max = 0;
    let pending = false;
    for (const question of questions) {
      max += question.maxMark;
      if (question.needsManual && question.score === null) {
        pending = true;
        continue;
      }
      score += question.score ?? 0;
    }
    return { score, max, pending };
  }

  private toClient(actor: Actor, attempt: QuizAttempt & { questions: AttemptQuestion[]; quiz: Quiz & { activity: { id: string; courseId: string; title: string; closeAt: Date | null } } }) {
    const teacher = attempt.userId !== actor.id;
    const mode = attempt.quiz.feedbackMode;
    const closedOpen = Boolean(attempt.quiz.activity.closeAt && attempt.quiz.activity.closeAt <= new Date());
    return {
      id: attempt.id,
      state: attempt.state,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      timeLimitSec: attempt.quiz.timeLimitSec,
      expiresAt: attempt.quiz.timeLimitSec ? new Date(attempt.startedAt.getTime() + attempt.quiz.timeLimitSec * 1000) : null,
      feedbackMode: mode,
      questionsPerPage: attempt.quiz.questionsPerPage,
      passFraction: attempt.quiz.passFraction,
      score: teacher || attempt.state !== "inprogress" ? attempt.score : null,
      maxScore: attempt.maxScore,
      questions: [...attempt.questions].sort((a, b) => a.position - b.position).map((question) => {
        const revealed = teacher || (mode === "closed" ? closedOpen && attempt.state !== "inprogress" : question.revealed || (attempt.state !== "inprogress" && mode !== "closed"));
        const dataset = this.dataset(question);
        const view = presentQuestion({ type: question.type, prompt: instantiateText(question.prompt, dataset), definition: question.definition, dataset });
        return {
          id: question.id,
          position: question.position,
          type: question.type,
          maxMark: question.maxMark,
          prompt: view.prompt,
          widget: view.widget,
          presentation: view.presentation,
          payload: view.payload,
          response: question.response,
          locked: question.locked,
          needsManual: question.needsManual,
          revealed,
          feedback: revealed ? question.feedback : null,
          score: revealed ? question.score : null,
          graderComment: revealed ? question.graderComment : null,
          solution: revealed ? solveQuestion({ type: question.type, definition: question.definition, dataset, locale: actor.locale === "en" ? "en" : "ru" }) : null,
        };
      }),
    };
  }

  private async pickRandom(rule: RandomRule | null, used: Set<string>, courseId: string) {
    if (!rule?.count) return [];
    const questions = await this.prisma.question.findMany({ where: this.poolWhere(rule, used, courseId) });
    return shuffle(questions).slice(0, rule.count);
  }

  private poolWhere(rule: RandomRule, used: Set<string>, courseId?: string): Prisma.QuestionWhereInput {
    return {
      status: "ready",
      id: used.size ? { notIn: [...used] } : undefined,
      categoryId: rule.categoryId || undefined,
      category: rule.categoryId || !courseId ? undefined : { OR: [{ courseId }, { courseId: null }] },
      type: rule.types?.length ? { in: rule.types } : undefined,
      tags: rule.tags?.length ? { some: { tag: { name: { in: rule.tags } } } } : undefined,
    };
  }

  private async quizForTeach(actor: Actor, activityId: string) {
    await this.quizByActivity(actor, activityId, true);
    const quiz = await this.prisma.quiz.findUnique({
      where: { activityId },
      include: { activity: true, slots: { orderBy: { position: "asc" }, include: { question: true } } },
    });
    if (!quiz) throw new BadRequestException({ message: "Тест не найден.", code: "not_found" });
    return quiz;
  }

  private async draw(
    quiz: Quiz & { activity: { courseId: string }; slots: { questionId: string | null; maxMark: number; randomRule: Prisma.JsonValue; question: { id: string; name: string; type: string; text: string } | null }[] },
    used: Set<string>,
    locale: "ru" | "en",
  ) {
    const questions: { id: string; name: string; type: string; text: string; maxMark: number; source: "fixed" | "random" }[] = [];
    const warnings: string[] = [];
    for (const [index, slot] of quiz.slots.entries()) {
      if (slot.question) {
        used.add(slot.question.id);
        questions.push({ id: slot.question.id, name: slot.question.name, type: slot.question.type, text: slot.question.text, maxMark: slot.maxMark, source: "fixed" });
        continue;
      }
      const rule = slot.randomRule as RandomRule | null;
      const requested = rule?.count ?? 0;
      const picked = await this.pickRandom(rule, used, quiz.activity.courseId);
      if (picked.length < requested) {
        warnings.push(locale === "en"
          ? `Slot ${index + 1}: the bank has ${picked.length} of ${requested}.`
          : `Слот ${index + 1}: в банке ${picked.length} из ${requested}.`);
      }
      for (const question of picked) {
        used.add(question.id);
        questions.push({ id: question.id, name: question.name, type: question.type, text: question.text, maxMark: slot.maxMark, source: "random" });
      }
    }
    return { questions, warnings };
  }

  private async freezeVariant(
    quiz: Quiz & { activity: { courseId: string; moduleId: string } },
    title: string,
    questions: { id: string; maxMark: number }[],
  ) {
    const last = await this.prisma.activity.findFirst({ where: { moduleId: quiz.activity.moduleId }, orderBy: { position: "desc" } });
    const activity = await this.prisma.activity.create({
      data: {
        courseId: quiz.activity.courseId,
        moduleId: quiz.activity.moduleId,
        type: "quiz",
        title,
        position: (last?.position ?? -1) + 1,
        weight: 1,
      },
    });
    const created = await this.prisma.quiz.create({
      data: {
        activityId: activity.id,
        timeLimitSec: quiz.timeLimitSec,
        attemptsAllowed: quiz.attemptsAllowed,
        shuffleQuestions: quiz.shuffleQuestions,
        shuffleAnswers: quiz.shuffleAnswers,
        gradeMethod: quiz.gradeMethod,
        feedbackMode: quiz.feedbackMode,
        questionsPerPage: quiz.questionsPerPage,
        passFraction: quiz.passFraction,
        slots: {
          create: questions.map((question, position) => ({ position, questionId: question.id, maxMark: question.maxMark })),
        },
      },
    });
    return { activityId: activity.id, quizId: created.id };
  }

  private async penaltyOf(questionId: string | null) {
    if (!questionId) return 0;
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    return question?.penalty ?? 0;
  }

  private dataset(question: AttemptQuestion): Record<string, number> | null {
    if (!question.dataset || typeof question.dataset !== "object" || Array.isArray(question.dataset)) return null;
    const entries = Object.entries(question.dataset as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number");
    return Object.fromEntries(entries);
  }

  private expired(attempt: QuizAttempt, quiz: Quiz) {
    if (!quiz.timeLimitSec) return false;
    return Date.now() > attempt.startedAt.getTime() + quiz.timeLimitSec * 1000;
  }

  private async loadQuiz(quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { activity: true, slots: { orderBy: { position: "asc" }, include: { question: true } } },
    });
    if (!quiz) throw new BadRequestException({ message: "Тест не найден.", code: "not_found" });
    return quiz;
  }

  private async quizByActivity(actor: Actor, activityId: string, teach: boolean) {
    const quiz = await this.prisma.quiz.findUnique({ where: { activityId }, include: { activity: true } });
    if (!quiz) throw new BadRequestException({ message: "Тест не найден.", code: "not_found" });
    if (teach) {
      const course = await this.policy.courseFor(actor, quiz.activity.courseId);
      this.policy.assertTeach(actor, course);
    }
    return quiz;
  }

  private async assertStudent(actor: Actor, activityId: string) {
    const view = await this.courses.getActivity(actor, activityId);
    if (view.activity && "locked" in view.activity && view.activity.locked) {
      throw new BadRequestException({ message: tr(actor.locale, "Тест пока закрыт.", "This quiz is locked."), code: view.activity.lockReason ?? "locked" });
    }
  }

  private async attemptFor(actor: Actor, attemptId: string) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: { questions: true, quiz: { include: { activity: true } } },
    });
    if (!attempt) this.policy.missing(actor);
    const teacher = await this.isTeacher(actor, attempt.quiz.activity.courseId);
    if (attempt.userId !== actor.id && !teacher) this.policy.forbid(actor);
    return attempt;
  }

  private async isTeacher(actor: Actor, courseId: string) {
    const course = await this.policy.courseFor(actor, courseId);
    return this.policy.canTeach(actor, course);
  }

  private async taughtCourseIds(actor: Actor): Promise<string[] | null> {
    if (this.policy.canManage(actor)) return null;
    const [enrollments, created] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { userId: actor.id, role: { in: ["teacher", "assistant"] } }, select: { courseId: true } }),
      this.prisma.course.findMany({ where: { createdById: actor.id }, select: { id: true } }),
    ]);
    return [...new Set([...enrollments.map((item) => item.courseId), ...created.map((item) => item.id)])];
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
