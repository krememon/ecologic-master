import { Link } from "wouter";
import { ChevronLeft, ChevronRight, MessageSquare, Bug, Lightbulb, HelpCircle } from "lucide-react";

const supportItems = [
  {
    href: "/settings/support/contact",
    icon: MessageSquare,
    label: "Contact Support",
    desc: "Send us a message",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/30",
  },
  {
    href: "/settings/support/bug",
    icon: Bug,
    label: "Report a Bug",
    desc: "Let us know what went wrong",
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-900/30",
  },
  {
    href: "/settings/support/feature",
    icon: Lightbulb,
    label: "Request a Feature",
    desc: "Suggest something new",
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-900/30",
  },
  {
    href: "/settings/support/faqs",
    icon: HelpCircle,
    label: "FAQs",
    desc: "Frequently asked questions",
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-900/30",
  },
];

export default function Support() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/settings">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Settings
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Support</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">How can we help?</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
        {supportItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${item.bg} flex items-center justify-center`}>
                  <item.icon className={`h-5 w-5 ${item.color}`} />
                </div>
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100 text-sm">{item.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{item.desc}</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
