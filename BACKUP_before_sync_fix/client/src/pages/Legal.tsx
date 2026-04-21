import { Link } from "wouter";
import { ChevronLeft, ChevronRight, FileText, Shield } from "lucide-react";

export default function Legal() {
  const items = [
    {
      icon: FileText,
      title: "Terms of Service",
      href: "/settings/legal/terms",
    },
    {
      icon: Shield,
      title: "Privacy Policy",
      href: "/settings/legal/privacy",
    },
  ];

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/settings">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Settings
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Legal</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Review our terms and policies
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {items.map((item, index) => (
          <Link key={item.href} href={item.href}>
            <div className={`flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors ${
              index !== items.length - 1 ? 'border-b border-slate-200 dark:border-slate-700' : ''
            }`}>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <item.icon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                </div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {item.title}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
