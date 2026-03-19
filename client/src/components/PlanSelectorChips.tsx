import { subscriptionPlans } from "@/config/subscriptionPlans";
import type { PlanKey } from "@/config/subscriptionPlans";

const PLAN_ORDER: PlanKey[] = ["starter", "team", "pro", "scale"];

interface PlanSelectorChipsProps {
  selected: PlanKey;
  onChange: (key: PlanKey) => void;
  disabled?: boolean;
  prices?: Partial<Record<PlanKey, string>>;
  loadingPrices?: boolean;
}

export function PlanSelectorChips({
  selected,
  onChange,
  disabled = false,
  prices,
  loadingPrices = false,
}: PlanSelectorChipsProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 text-center">
        Choose your plan
      </p>
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {PLAN_ORDER.map((key) => {
          const plan = subscriptionPlans[key];
          const isSelected = key === selected;
          const priceStr = prices?.[key] ?? `$${plan.price}`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              disabled={disabled}
              className={`
                flex-shrink-0 flex flex-col items-center justify-center
                min-w-[76px] px-3 py-3 rounded-2xl border-2
                transition-all duration-150 disabled:opacity-50
                ${isSelected
                  ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900"
                  : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-300 dark:hover:border-blue-600"
                }
              `}
            >
              <span className="text-sm font-bold leading-tight">{plan.label}</span>
              <span className={`text-xs mt-0.5 leading-tight font-medium ${
                isSelected ? "text-blue-100" : "text-slate-400 dark:text-slate-400"
              }`}>
                {loadingPrices ? "…" : priceStr}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
