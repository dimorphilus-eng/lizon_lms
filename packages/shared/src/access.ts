export type AccessCondition =
  | { type: "date"; from?: string | null; until?: string | null }
  | { type: "completion"; activityId: string }
  | { type: "grade"; activityId: string; minFraction: number }
  | { type: "group"; groupIds: string[] }
  | { type: "all"; conditions: AccessCondition[] }
  | { type: "any"; conditions: AccessCondition[] };

export interface AccessContext {
  now: Date;
  completedActivityIds: Iterable<string>;
  /** Доля 0..1 по activityId. */
  grades: Record<string, number>;
  groupIds: string[];
}

export interface AccessDecision {
  open: boolean;
  reason?: "not_yet_open" | "closed" | "requires_completion" | "requires_grade" | "requires_group";
}

export function evaluateAccess(
  condition: AccessCondition | null | undefined,
  ctx: AccessContext,
): AccessDecision {
  if (!condition) return { open: true };
  const completed = new Set(ctx.completedActivityIds);

  const visit = (node: AccessCondition): AccessDecision => {
    if (node.type === "all") {
      for (const child of node.conditions) {
        const decision = visit(child);
        if (!decision.open) return decision;
      }
      return { open: true };
    }
    if (node.type === "any") {
      if (node.conditions.length === 0) return { open: false, reason: "requires_completion" };
      let last: AccessDecision = { open: false, reason: "requires_completion" };
      for (const child of node.conditions) {
        last = visit(child);
        if (last.open) return { open: true };
      }
      return last;
    }
    if (node.type === "date") {
      if (node.from && ctx.now < new Date(node.from)) return { open: false, reason: "not_yet_open" };
      if (node.until && ctx.now > new Date(node.until)) return { open: false, reason: "closed" };
      return { open: true };
    }
    if (node.type === "completion") {
      return completed.has(node.activityId)
        ? { open: true }
        : { open: false, reason: "requires_completion" };
    }
    if (node.type === "grade") {
      const grade = ctx.grades[node.activityId];
      if (grade === undefined || grade < node.minFraction) return { open: false, reason: "requires_grade" };
      return { open: true };
    }
    const wanted = new Set(node.groupIds);
    const inside = ctx.groupIds.some((id) => wanted.has(id));
    return inside ? { open: true } : { open: false, reason: "requires_group" };
  };

  return visit(condition);
}
