export const PLANS = ["BASIC", "PRO", "PREMIUM"] as const;

export type Plan = (typeof PLANS)[number];

export interface PlanLimits {
  maxUsers: number;
  maxMessages: number;
  maxProducts: number;
}

export const DEFAULT_PLAN: Plan = "BASIC";

export const PLAN_CATALOG: Record<Plan, PlanLimits> = {
  BASIC: { maxUsers: 2, maxMessages: 500, maxProducts: 10 },
  PRO: { maxUsers: 10, maxMessages: 10_000, maxProducts: 100 },
  PREMIUM: { maxUsers: 50, maxMessages: 100_000, maxProducts: 1_000 },
};

export function isPlan(value: string | undefined | null): value is Plan {
  if (typeof value !== "string") {
    return false;
  }
  return (PLANS as readonly string[]).includes(value);
}

export function resolvePlan(plan: string | undefined | null): Plan {
  return isPlan(plan) ? plan : DEFAULT_PLAN;
}