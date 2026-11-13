import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();
const PASSWORD = "LizonDemo!2026";

const PERMISSIONS: [string, string][] = [
  ["users.read", "Просмотр пользователей"],
  ["users.manage", "Управление пользователями"],
  ["roles.manage", "Управление ролями"],
  ["courses.read", "Просмотр курсов"],
  ["courses.create", "Создание курсов"],
  ["courses.update", "Редактирование курсов"],
  ["courses.delete", "Удаление курсов"],
  ["courses.publish", "Публикация курсов"],
  ["courses.manage", "Управление всеми курсами"],
  ["courses.enroll", "Запись на курсы"],
  ["content.author", "Авторство материалов"],
  ["questions.manage", "Банк вопросов"],
  ["quizzes.grade", "Проверка тестов"],
  ["assignments.grade", "Проверка заданий"],
  ["templates.manage", "Шаблоны курсов"],
  ["settings.manage", "Глобальные настройки"],
  ["certificates.issue", "Сертификаты"],
];

const TEACHER = ["courses.read", "courses.create", "courses.update", "courses.publish", "courses.enroll", "content.author", "questions.manage", "quizzes.grade", "assignments.grade", "certificates.issue"];
const ROLES: Record<string, { name: string; description: string; permissions: string[] }> = {
  student: { name: "Студент", description: "Учится на курсах", permissions: ["courses.read"] },
  teacher: { name: "Преподаватель", description: "Ведёт курсы и проверяет работы", permissions: TEACHER },
  methodist: { name: "Методист", description: "Собирает программы и шаблоны", permissions: [...TEACHER, "courses.delete", "courses.manage", "templates.manage", "users.read", "users.manage"] },
  admin: { name: "Администратор", description: "Полный доступ", permissions: PERMISSIONS.map(([code]) => code) },
};

async function main() {
  const permissionIds = new Map<string, string>();
  for (const [code, description] of PERMISSIONS) {
    const row = await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
    permissionIds.set(code, row.id);
  }
  const roleIds = new Map<string, string>();
  for (const [code, role] of Object.entries(ROLES)) {
    const row = await prisma.role.upsert({
      where: { code },
      update: { name: role.name, description: role.description, isSystem: true },
      create: { code, name: role.name, description: role.description, isSystem: true },
    });
    roleIds.set(code, row.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: row.id } });
    await prisma.rolePermission.createMany({ data: role.permissions.map((permission) => ({ roleId: row.id, permissionId: permissionIds.get(permission)! })) });
  }

  const passwordHash = await hash(PASSWORD, 10);
  const users = {
    admin: await user("admin@lizon.test", "Алла", "Админова", ["admin"], passwordHash),
    methodist: await user("methodist@lizon.test", "Мира", "Методист", ["methodist"], passwordHash),
    teacher: await user("teacher@lizon.test", "Тимофей", "Лекторов", ["teacher"], passwordHash),
    student: await user("student@lizon.test", "Софья", "Ильина", ["student"], passwordHash, { city: "Казань" }),
    student2: await user("student2@lizon.test", "Марк", "Орлов", ["student", "teacher"], passwordHash),
  };

  await prisma.course.deleteMany({ where: { slug: "data-literacy" } });
  const course = await prisma.course.create({
    data: {
      title: "Дата-грамотность",
      slug: "data-literacy",
      summary: "Короткий курс о том, как смотреть на числа, не обманывая себя. Внутри уроки, тест почти всех типов вопросов Moodle, задание и обсуждение.",
      language: "ru",
      status: "published",
      enrollmentMode: "open",
      passingGrade: 0.6,
      certificateEnabled: true,
      metadata: { level: "beginner" },
      createdById: users.teacher.id,
    },
  });

  const lesson = await moduleWith(course.id, 0, "Смотреть на данные", [
    {
      type: "lesson",
      title: "Что считать данным",
      content: {
        format: "markdown",
        body: "Данные — это не «правда», а следы наблюдения.\n\nСреднее удобно, пока в выборке нет одного очень большого числа. Медиана в таком случае спокойнее: она смотрит на середину упорядоченного ряда, а не на сумму.",
        videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        blocks: [
          {
            id: "cards",
            type: "cards",
            cards: [
              { id: "c1", front: "Среднее", back: "Сумма, делённая на число наблюдений." },
              { id: "c2", front: "Медиана", back: "Середина упорядоченного ряда." },
              { id: "c3", front: "Мода", back: "Самое частое значение." },
            ],
          },
          {
            id: "practice",
            type: "quiz",
            questions: [
              {
                id: "p1",
                type: "truefalse",
                text: "Один выброс всегда сильно сдвигает медиану.",
                definition: { correct: false },
              },
            ],
          },
        ],
      },
    },
    { type: "resource", title: "Шпаргалка", content: { format: "markdown", body: "Три вопроса перед графиком: что измеряли, кого не увидели, какая сводка уместна.", link: "https://ru.wikipedia.org/wiki/Медиана_(статистика)" } },
    {
      type: "interactive",
      title: "Рост и предел",
      content: {
        format: "markdown",
        body: "Покрутите параметры логистического роста. Население не растёт прямой линией, если есть предел среды.",
        blocks: [{ id: "sim", type: "simulation", simulation: "logistic", title: "Логистический рост" }],
      },
    },
  ]);

  const check = await moduleWith(course.id, 1, "Проверить себя", []);
  await prisma.module.update({
    where: { id: check.id },
    data: { availability: { type: "completion", activityId: lesson.activities[0].id } },
  });
  const quizActivity = await prisma.activity.create({
    data: { courseId: course.id, moduleId: check.id, type: "quiz", title: "Проверка понимания", position: 0, weight: 2 },
  });
  const quiz = await prisma.quiz.create({
    data: { activityId: quizActivity.id, timeLimitSec: 20 * 60, attemptsAllowed: 0, shuffleQuestions: false, shuffleAnswers: true, feedbackMode: "deferred", gradeMethod: "highest", passFraction: 0.6, questionsPerPage: 1 },
  });
  const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const assignmentActivity = await prisma.activity.create({
    data: { courseId: course.id, moduleId: check.id, type: "assignment", title: "Короткий разбор", position: 1, dueAt: due, weight: 1 },
  });
  await prisma.assignment.create({
    data: { activityId: assignmentActivity.id, maxMark: 10, maxFiles: 2, instructions: "Опишите набор данных, который легко неверно усреднить. Достаточно одного абзаца или файла." },
  });

  const talk = await moduleWith(course.id, 2, "Обсудить", [
    { type: "forum", title: "Как вы смотрите на данные", content: { format: "markdown", body: "Принесите пример сводки, которая вас однажды обманула." } },
  ]);

  const category = await prisma.questionCategory.create({ data: { name: "Дата-грамотность", courseId: course.id } });
  const bank = await seedQuestions(category.id, users.teacher.id);
  await prisma.quizSlot.createMany({
    data: [
      ...bank.quiz.map((question, position) => ({ quizId: quiz.id, position, questionId: question.id, maxMark: 1 })),
      { quizId: quiz.id, position: bank.quiz.length, questionId: null, maxMark: 1, randomRule: { categoryId: category.id, tags: ["pool"], count: 1 } as Prisma.InputJsonValue },
    ],
  });

  const group = await prisma.courseGroup.create({ data: { courseId: course.id, name: "Группа A" } });
  for (const person of [users.teacher, users.student, users.student2]) {
    await prisma.enrollment.create({
      data: { userId: person.id, courseId: course.id, role: person.id === users.teacher.id ? "teacher" : "student" },
    });
  }
  await prisma.groupMember.create({ data: { groupId: group.id, userId: users.student.id } });
  await prisma.activityCompletion.create({ data: { userId: users.student.id, activityId: lesson.activities[0].id } });
  await prisma.enrollment.update({
    where: { userId_courseId: { userId: users.student.id, courseId: course.id } },
    data: { progress: 1 / 6, lastActivityId: lesson.activities[0].id },
  });
  await prisma.discussionPost.create({
    data: { activityId: talk.activities[0].id, authorId: users.teacher.id, body: "Начнём с простого: где среднее вас подвело?" },
  });
  await prisma.notification.create({
    data: { userId: users.student.id, type: "enrollment", title: "Вы записаны: Дата-грамотность", link: `/learn/courses/${course.id}` },
  });

  await prisma.setting.upsert({ where: { key: "platformName" }, update: { value: "Lizon" }, create: { key: "platformName", value: "Lizon" } });
  await prisma.setting.upsert({ where: { key: "allowRegistration" }, update: { value: true }, create: { key: "allowRegistration", value: true } });
  await prisma.customFieldDefinition.upsert({
    where: { entity_key: { entity: "user", key: "city" } },
    update: {},
    create: { entity: "user", key: "city", label: "Город", fieldType: "text" },
  });
  await prisma.customFieldDefinition.upsert({
    where: { entity_key: { entity: "course", key: "level" } },
    update: {},
    create: { entity: "course", key: "level", label: "Уровень", fieldType: "select", options: ["beginner", "intermediate", "advanced"] },
  });
  await prisma.courseTemplate.deleteMany({ where: { name: "Короткий курс" } });
  await prisma.courseTemplate.create({
    data: {
      name: "Короткий курс",
      description: "Модуль, урок и тест.",
      createdById: users.methodist.id,
      blueprint: {
        summary: "Шаблон на одну неделю.",
        modules: [{ title: "Неделя 1", activities: [{ type: "lesson", title: "Вводный урок" }, { type: "quiz", title: "Проверка" }] }],
      },
    },
  });

  console.log("Seeded Lizon. Password for demo accounts:", PASSWORD);
}

async function user(email: string, firstName: string, lastName: string, roles: string[], passwordHash: string, customFields: Record<string, string> = {}) {
  const row = await prisma.user.upsert({
    where: { email },
    update: { firstName, lastName, passwordHash, isActive: true, customFields },
    create: { email, firstName, lastName, passwordHash, customFields },
  });
  const roleRows = await prisma.role.findMany({ where: { code: { in: roles } } });
  await prisma.userRole.deleteMany({ where: { userId: row.id } });
  await prisma.userRole.createMany({ data: roleRows.map((role) => ({ userId: row.id, roleId: role.id })) });
  const events = ["grade", "deadline", "enrollment", "certificate", "discussion"];
  for (const event of events) {
    await prisma.notificationPreference.upsert({
      where: { userId_event: { userId: row.id, event } },
      update: {},
      create: { userId: row.id, event, inApp: true, email: false },
    });
  }
  return row;
}

async function moduleWith(courseId: string, position: number, title: string, activities: { type: string; title: string; content?: unknown }[]) {
  const module = await prisma.module.create({ data: { courseId, title, position } });
  const created = [];
  for (const [index, activity] of activities.entries()) {
    created.push(await prisma.activity.create({
      data: { courseId, moduleId: module.id, type: activity.type, title: activity.title, position: index, content: (activity.content ?? { format: "markdown", body: "" }) as Prisma.InputJsonValue },
    }));
  }
  return { ...module, activities: created };
}

async function seedQuestions(categoryId: string, authorId: string) {
  const make = async (input: { type: string; name: string; text: string; definition: unknown; tags?: string[]; penalty?: number }) =>
    prisma.question.create({
      data: {
        categoryId,
        authorId,
        type: input.type,
        name: input.name,
        text: input.text,
        definition: input.definition as Prisma.InputJsonValue,
        penalty: input.penalty ?? 0,
        tags: input.tags ? { create: await Promise.all(input.tags.map(async (name) => ({ tagId: (await prisma.tag.upsert({ where: { name }, update: {}, create: { name } })).id }))) } : undefined,
      },
    });

  const quiz = [
    await make({ type: "multichoice", name: "Выбросы", text: "Что устойчивее к выбросам?", definition: { single: true, choices: [{ id: "mean", text: "Среднее", fraction: 0 }, { id: "median", text: "Медиана", fraction: 1 }] } }),
    await make({ type: "truefalse", name: "Среднее", text: "Среднее всегда описывает типичное значение лучше медианы.", definition: { correct: false } }),
    await make({ type: "shortanswer", name: "Метр", text: "Сколько сантиметров в метре?", definition: { caseSensitive: false, answers: [{ text: "100", fraction: 1 }, { text: "сто", fraction: 1 }] } }),
    await make({ type: "numerical", name: "Проценты", text: "Чему равны 10 процентов от 250?", definition: { answers: [{ value: 25, tolerance: 0, toleranceType: "absolute", fraction: 1 }] } }),
    await make({ type: "matching", name: "Сводки", text: "Соедините сводку и определение.", definition: { pairs: [{ id: "mean", stem: "Среднее", answer: "Сумма, делённая на число" }, { id: "median", stem: "Медиана", answer: "Середина упорядоченного ряда" }], distractors: ["Самый крайний выброс"] } }),
    await make({ type: "ordering", name: "Шаги", text: "Расставьте шаги исследования.", definition: { items: [{ id: "q", text: "Задать вопрос" }, { id: "c", text: "Собрать данные" }, { id: "a", text: "Посчитать" }, { id: "r", text: "Сделать вывод" }] } }),
    await make({ type: "cloze", name: "Середина", text: "Вложенный ответ", definition: { template: "Медиана делит упорядоченную выборку [[half]].", gaps: [{ id: "half", type: "multichoice", weight: 1, choices: [{ id: "two", text: "пополам", fraction: 1 }, { id: "three", text: "на три части", fraction: 0 }] }] } }),
    await make({ type: "essay", name: "Смещение", text: "Опишите, как смещение выборки портит вывод.", definition: { minWords: 5 } }),
  ];
  await make({ type: "shortanswer", name: "Минуты", text: "Сколько минут в часе?", definition: { caseSensitive: false, answers: [{ text: "60", fraction: 1 }] }, tags: ["pool"] });
  await make({ type: "shortanswer", name: "Неделя", text: "Сколько дней в неделе?", definition: { caseSensitive: false, answers: [{ text: "7", fraction: 1 }] }, tags: ["pool"] });
  await make({ type: "multichoice", name: "Несколько свойств", text: "Что относится к хорошему графику?", penalty: 0.333, definition: { single: false, choices: [{ id: "a", text: "Подписанные оси", fraction: 0.5 }, { id: "b", text: "Понятная единица", fraction: 0.5 }, { id: "c", text: "Обрезанная шкала без пометки", fraction: -0.5 }] } });
  await make({ type: "calculated", name: "Сумма", text: "Сложите {a} и {b}.", definition: { formula: "{a}+{b}", tolerance: 0, toleranceType: "absolute", variables: ["a", "b"], datasets: [{ a: 2, b: 3 }], unit: "" } });
  await make({ type: "calculatedmc", name: "Произведение", text: "Какое выражение равно произведению?", definition: { formula: "{a}*{b}", tolerance: 0.001, variables: ["a", "b"], datasets: [{ a: 4, b: 5 }], choices: [{ id: "c1", formula: "{a}*{b}" }, { id: "c2", formula: "{a}+{b}" }] } });
  await make({ type: "gapselect", name: "Пропуски", text: "Выберите слова.", definition: { template: "Медиана — это [[1]] ряда.", choices: [{ id: "m", text: "середина", group: "a" }, { id: "s", text: "сумма", group: "a" }], gaps: [{ id: "1", correctChoiceId: "m", group: "a" }] } });
  await make({ type: "ddtext", name: "В текст", text: "Перетащите слова.", definition: { template: "Мода — это [[1]].", gaps: [{ id: "1", correctOptionId: "mode" }], options: [{ id: "mode", text: "самое частое значение" }, { id: "mean", text: "сумма" }] } });
  await make({ type: "ddmatch", name: "Перетаскивание пар", text: "Перетащите определения.", definition: { pairs: [{ id: "p1", stem: "Мода", answer: "Частое значение" }, { id: "p2", stem: "Размах", answer: "Разница краёв" }], distractors: [] } });
  await make({ type: "description", name: "Пауза", text: "Дальше будут вопросы про сводки. Калькулятор не нужен.", definition: { text: "" } });
  await make({ type: "hotspot", name: "Точка", text: "Отметьте левый верхний угол.", definition: { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png", multiple: false, regions: [{ id: "r1", shape: "rect", coords: [0, 0, 30, 30], fraction: 1 }] } });
  await make({ type: "ddimage", name: "На изображение", text: "Поместите подпись в зону.", definition: { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png", drops: [{ id: "z1", x: 10, y: 10, w: 30, h: 30, label: "угол" }], drags: [{ id: "d1", text: "Метка", correctDropId: "z1" }] } });
  await make({ type: "scale", name: "Уверенность", text: "Насколько уверенно вы отличите среднее от медианы?", definition: { min: 1, max: 5, step: 1 } });
  return { quiz };
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
