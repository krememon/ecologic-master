export interface SubscriptionPlan {
  label: string;
  price: number;
  userLimit: number;
  productId: string;
  appleProductId: string;
}

export const subscriptionPlans: Record<string, SubscriptionPlan> = {
  starter: {
    label: "Starter",
    price: 29.99,
    userLimit: 1,
    productId: "ecologic_starter",
    appleProductId: "com.ecologic.app.starter.monthly",
  },
  team: {
    label: "Team",
    price: 79.99,
    userLimit: 5,
    productId: "ecologic_team",
    appleProductId: "com.ecologic.app.team.monthly",
  },
  pro: {
    label: "Pro",
    price: 159.99,
    userLimit: 10,
    productId: "ecologic_pro",
    appleProductId: "com.ecologic.app.pro.monthly",
  },
  scale: {
    label: "Scale",
    price: 299.99,
    userLimit: 15,
    productId: "ecologic_scale",
    appleProductId: "com.ecologic.app.scale.monthly",
  },
};

export type PlanKey = keyof typeof subscriptionPlans;

// Reverse lookup: Apple product ID → EcoLogic plan key
// Used by backend validation and webhook handlers.
export const appleProductIdToPlanKey: Record<string, string> = Object.fromEntries(
  Object.entries(subscriptionPlans).map(([key, plan]) => [plan.appleProductId, key])
);

const teamSizeToPlan: Record<string, PlanKey> = {
  "1": "starter",
  "2-5": "team",
  "6-10": "pro",
  "11-15": "scale",
};

export function getPlanForTeamSize(selection: string): PlanKey {
  return teamSizeToPlan[selection] || "starter";
}
