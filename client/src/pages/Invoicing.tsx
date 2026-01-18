import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, DollarSign, Calendar, ExternalLink } from "lucide-react";
import type { Invoice } from "@shared/schema";
import { NewInvoiceSheet } from "@/components/NewInvoiceSheet";
import { useTranslation } from "react-i18next";

export default function Invoicing() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // Handle create=true URL param from global create menu
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get('create') === 'true') {
      setIsSheetOpen(true);
      // Clear the param from URL
      setLocation('/invoicing', { replace: true });
    }
  }, [searchString, setLocation]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    enabled: isAuthenticated,
  });

  // RBAC: Check if user can create invoices
  const canCreateInvoice = user?.role && ['owner', 'supervisor', 'dispatcher', 'estimator'].includes(user.role);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
          <p className="text-muted-foreground">Please log in to access invoicing.</p>
        </div>
      </div>
    );
  }

  if (invoicesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'paid':
        return 'default';
      case 'sent':
      case 'pending':
        return 'secondary';
      case 'draft':
        return 'outline';
      case 'overdue':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const formatAmount = (invoice: Invoice) => {
    if (invoice.totalCents && invoice.totalCents > 0) {
      return `$${(invoice.totalCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
    if (invoice.amount) {
      return `$${parseFloat(invoice.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
    return '$0.00';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Invoicing</h1>
        <p className="text-slate-600 dark:text-slate-400">Create and manage invoices for your projects</p>
      </div>

      <NewInvoiceSheet 
        open={isSheetOpen} 
        onOpenChange={setIsSheetOpen}
        onInvoiceCreated={(invoice) => {
          console.log('Invoice created:', invoice);
        }}
      />

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Invoices ({invoices.length})
        </h3>
        {canCreateInvoice && (
          <Button onClick={() => setIsSheetOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Invoice
          </Button>
        )}
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No invoices yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start billing your clients by creating your first invoice.
            </p>
            {canCreateInvoice && (
              <Button onClick={() => setIsSheetOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Invoice
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {invoices.map((invoice: any) => (
            <Card key={invoice.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    {invoice.invoiceNumber || `Invoice #${invoice.id}`}
                  </CardTitle>
                  <Badge variant={getStatusBadgeVariant(invoice.status)}>
                    {invoice.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoice.customer && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {invoice.customer.firstName} {invoice.customer.lastName}
                  </p>
                )}
                {invoice.client && !invoice.customer && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {invoice.client.name}
                  </p>
                )}
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <DollarSign className="h-4 w-4" />
                  {formatAmount(invoice)}
                </div>
                {invoice.dueDate && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    Due: {new Date(invoice.dueDate).toLocaleDateString()}
                  </div>
                )}
                {invoice.scheduledAt && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Calendar className="h-4 w-4" />
                    Scheduled: {new Date(invoice.scheduledAt).toLocaleDateString()}
                  </div>
                )}
                {invoice.pdfUrl && (
                  <a 
                    href={invoice.pdfUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View PDF
                  </a>
                )}
                {(invoice.tags as string[] | null)?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(invoice.tags as string[]).map((tag: string, i: number) => (
                      <span 
                        key={i} 
                        className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-600 dark:text-slate-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    Created {new Date(invoice.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
