import { ConflictError } from "../errors";
import {
  PLAN_CATALOG,
  resolvePlan,
  type PlanLimits,
} from "./plan-catalog";

export class LimitsService {
  getLimits(plan: string | undefined | null): PlanLimits {
    return PLAN_CATALOG[resolvePlan(plan)];
  }

  assertUnderLimit(
    current: number,
    limitKey: keyof PlanLimits,
    plan: string | undefined | null,
  ): void {
    const limit = this.getLimits(plan)[limitKey];
    if (current >= limit) {
      throw new ConflictError("conflict", "Límite del plan superado", {
        limitKey,
        limit,
        current,
        plan: resolvePlan(plan),
      });
    }
  }
}

export type { Plan, PlanLimits } from "./plan-catalog";