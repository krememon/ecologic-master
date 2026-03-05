import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "How do I clock in/out?",
    a: "From the Home screen, tap the Clock In button. Select a job or category, and you'll start tracking time. When you're done, tap Clock Out. Your hours are recorded automatically.",
  },
  {
    q: "How do job assignments work?",
    a: "Owners and Supervisors can assign crew members to jobs. Once assigned, Technicians will see those jobs on their Home screen and Schedule. Assignments also control who receives job-related notifications.",
  },
  {
    q: "How do notifications work?",
    a: "You'll receive in-app notifications for important events like new job assignments, messages, payments, and schedule changes. You can manage notification preferences in Settings.",
  },
  {
    q: "How do subscriptions work?",
    a: "EcoLogic uses team-size-based plans. Your plan is automatically selected based on the number of members in your company. You can manage billing details in Settings under Subscription.",
  },
  {
    q: "What if I forget to clock out?",
    a: "If you forget to clock out, the system will auto clock you out at the end of the day. Managers can also edit timesheets to correct any missed clock-outs.",
  },
  {
    q: "How do I send an invoice?",
    a: "From a job, go to the Invoice tab and create an invoice. Once created, you can send it to your customer via email or SMS. Customers can pay online using a secure payment link.",
  },
  {
    q: "Can I use EcoLogic on my phone?",
    a: "Yes. EcoLogic works as a web app on any device. We also have a native iOS app available for download. The app supports push notifications, location tracking, and all core features.",
  },
];

export default function FAQs() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="mb-6">
        <Link href="/settings/support">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Support
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">FAQs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Frequently asked questions</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
        {faqs.map((faq, i) => {
          const isOpen = openIndex === i;
          return (
            <div key={i}>
              <button
                className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                onClick={() => setOpenIndex(isOpen ? null : i)}
              >
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100 pr-4">{faq.q}</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 -mt-1">
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
