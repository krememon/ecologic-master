export interface SubscriptionPlan {
  label: string;
  price: number;
  userLimit: number;
  productId: string;
  appleProductId: string;
  googlePlayProductId: string;
}

export const subscriptionPlans: Record<string, SubscriptionPlan> = {
  starter: {
    label: "Starter",
    price: 29.99,
    userLimit: 1,
    productId: "ecologic_starter",
    appleProductId: "ecologic_starter",
    googlePlayProductId: "ecologic_starter_monthly",
  },
  team: {
    label: "Team",
    price: 79.99,
    userLimit: 5,
    productId: "ecologic_team",
    appleProductId: "ecologic_team",
    googlePlayProductId: "ecologic_team_monthly",
  },
  pro: {
    label: "Pro",
    price: 159.99,
    userLimit: 10,
    productId: "ecologic_pro",
    appleProductId: "ecologic_pro",
    googlePlayProductId: "ecologic_pro_monthly",
  },
  scale: {
    label: "Scale",
    price: 299.99,
    userLimit: 15,
    productId: "ecologic_scale",
    appleProductId: "ecologic_scale",
    googlePlayProductId: "ecologic_scale_monthly",
  },
};

export type PlanKey = keyof typeof subscriptionPlans;

// Reverse lookup: Apple product ID → EcoLogic plan key
export const appleProductIdToPlanKey: Record<string, string> = Object.fromEntries(
  Object.entries(subscriptionPlans).map(([key, plan]) => [plan.appleProductId, key])
);

// Reverse lookup: Google Play product ID → EcoLogic plan key
export const googlePlayProductIdToPlanKey: Record<string, string> = Object.fromEntries(
  Object.entries(subscriptionPlans).map(([key, plan]) => [plan.googlePlayProductId, key])
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
