import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Link, useSearch } from "wouter";
import { Loader2, ChevronRight, BookOpen, Settings2, Building2, Percent, Clock, Mail, Landmark, FileText } from "lucide-react";
import quickbooksLogo from "@assets/quickbooks_1771259795992.png";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Customize() {
  const { isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const { toast } = useToast();
  const searchString = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const qbStatus = params.get('quickbooks');
    if (qbStatus === 'connected') {
      toast({
        title: "QuickBooks Connected",
        description: "Your QuickBooks account has been successfully connected.",
      });
      window.history.replaceState({}, '', '/customize');
    } else if (qbStatus === 'error') {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to QuickBooks. Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', '/customize');
    }
  }, [searchString, toast]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!can('customize.manage')) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center shadow-sm border border-slate-200 dark:border-slate-700">
          <Settings2 className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Not Authorized</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Only Owners can access customization settings.
          </p>
        </div>
      </div>
    );
  }

  const menuItems = [
    {
      icon: Building2,
      title: "Company profile",
      description: "Manage your company's identity and branding",
      href: "/customize/company-profile",
    },
    {
      icon: BookOpen,
      title: "Price book",
      description: "Manage reusable line items for estimates",
      href: "/customize/price-book",
    },
    {
      icon: Percent,
      title: "Taxes",
      description: "Create custom tax rates for invoices",
      href: "/customize/taxes",
    },
    {
      icon: FileText,
      title: "Estimates",
      description: "Configure estimate conversion and archival settings",
      href: "/customize/estimates",
    },
    {
      icon: Clock,
      title: "Time Tracking",
      description: "Configure auto clock-out and time settings",
      href: "/customize/time-tracking",
    },
    {
      icon: null,
      image: quickbooksLogo,
      title: "QuickBooks",
      description: "Connect to QuickBooks Online for accounting",
      href: "/customize/quickbooks",
    },
    {
      icon: Mail,
      title: "Email Branding",
      description: "Customize look of campaign emails",
      href: "/customize/email-branding",
    },
    {
      icon: Landmark,
      title: "Financial Connections",
      description: "Link your bank account for payments and refunds",
      href: "/customize/financial-connections",
    },
  ];

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Customize
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Manage templates and settings for your company
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {menuItems.map((item, index) => (
          <Link key={item.href} href={item.href}>
            <div className={`flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors ${
              index !== menuItems.length - 1 ? 'border-b border-slate-200 dark:border-slate-700' : ''
            }`}>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                  {item.image ? (
                    <img src={item.image} alt={item.title} className="h-6 w-6 object-contain" />
                  ) : item.icon ? (
                    <item.icon className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  ) : null}
                </div>
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {item.title}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {item.description}
                  </div>
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
