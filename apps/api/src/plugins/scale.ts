import { SCALE_PLUGIN, registerQuestionPlugin } from "@lizon/shared";

/** Пример плагина: тип вопроса вне ядра каталога Moodle. Подключается при старте API. */
export function registerScalePlugin() {
  try {
    registerQuestionPlugin(SCALE_PLUGIN);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already registered")) throw error;
  }
}
