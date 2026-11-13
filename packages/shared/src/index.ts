import { registerBuiltinQuestionPlugins } from "./questions/engine";

registerBuiltinQuestionPlugins();

export { evaluateAccess, type AccessCondition, type AccessContext, type AccessDecision } from "./access";
export { FormulaError, assertFormula, evaluateFormula, formulaVariables } from "./formula";
export { videoEmbed, type VideoEmbed } from "./media";
export { wildcardMatch } from "./wildcard";
export {
  SCALE_PLUGIN,
  emptyDefinition,
  getQuestionPlugin,
  gradeQuestion,
  listQuestionTypes,
  materializeQuestion,
  presentQuestion,
  registerBuiltinQuestionPlugins,
  registerQuestionPlugin,
  solveQuestion,
  validateDefinition,
} from "./questions/engine";
export { QuestionValidationError } from "./questions/types";
export type {
  ExportQuestion,
  FeedbackMode,
  GradeResult,
  ImportedQuestion,
  Locale,
  PublicQuestion,
  QuestionPlugin,
  SolutionView,
  Widget,
} from "./questions/types";
export { explainValidation, instantiateText } from "./questions/util";
export { exportQuestions, importQuestions, parseMoodleCloze, type TransferResult } from "./questions/transfer";
