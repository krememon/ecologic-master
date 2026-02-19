export interface SubscriptionPlan {
  label: string;
  price: number;
  userLimit: number;
  productId: string;
}

export const subscriptionPlans: Record<string, SubscriptionPlan> = {
  starter: { label: "Starter", price: 29.99, userLimit: 1, productId: "ecologic_starter" },
  team: { label: "Team", price: 79.99, userLimit: 5, productId: "ecologic_team" },
  pro: { label: "Pro", price: 159.99, userLimit: 10, productId: "ecologic_pro" },
  scale: { label: "Scale", price: 299.99, userLimit: 15, productId: "ecologic_scale" },
};

export type PlanKey = keyof typeof subscriptionPlans;

const teamSizeToPlan: Record<string, PlanKey> = {
  "1": "starter",
  "2-5": "team",
  "6-10": "pro",
  "11-15": "scale",
};

export function getPlanForTeamSize(selection: string): PlanKey {
  return teamSizeToPlan[selection] || "starter";
}
