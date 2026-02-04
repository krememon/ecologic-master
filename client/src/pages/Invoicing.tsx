import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, DollarSign, Calendar, ExternalLink, CheckSquare, X, Check, Trash2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Invoice } from "@shared/schema";
import { NewInvoiceSheet } from "@/components/NewInvoiceSheet";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Invoicing() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<number>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
        window.location.href = "/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    enabled: isAuthenticated,
  });

  // RBAC: Check user permissions
  const userRole = user?.role?.toLowerCase() || '';
  const canCreateInvoice = ['owner', 'supervisor', 'dispatcher', 'estimator'].includes(userRole);
  const canManageInvoices = ['owner', 'supervisor'].includes(userRole);

  // Filter invoices by search query
  const filteredInvoices = useMemo(() => {
    if (!invoices || invoices.length === 0) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return invoices;
    
    return invoices.filter((invoice: any) => {
      const invoiceNumber = (invoice.invoiceNumber || `Invoice #${invoice.id}`).toLowerCase();
      const customerName = invoice.customer 
        ? `${invoice.customer.firstName || ''} ${invoice.customer.lastName || ''}`.toLowerCase()
        : '';
      const clientName = invoice.client?.name?.toLowerCase() || '';
      const amount = invoice.totalCents 
        ? (invoice.totalCents / 100).toFixed(2)
        : invoice.amount || '';
      const status = (invoice.status || '').toLowerCase();
      const tags = ((invoice.tags as string[] | null) || []).join(' ').toLowerCase();
      
      return invoiceNumber.includes(query) || 
             customerName.includes(query) || 
             clientName.includes(query) ||
             amount.includes(query) ||
             status.includes(query) ||
             tags.includes(query);
    });
  }, [invoices, searchQuery]);

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (invoiceIds: number[]) => {
      const res = await apiRequest("POST", "/api/invoices/bulk-delete", { invoiceIds });
      return res.json();
    },
    onSuccess: async () => {
      // Force refetch to get updated data from server
      await queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      await queryClient.refetchQueries({ queryKey: ["/api/invoices"] });
      exitSelectMode();
      setDeleteConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete invoices",
        variant: "destructive",
      });
    },
  });

  // Toggle invoice selection
  const toggleInvoiceSelection = (invoiceId: number) => {
    const newSelected = new Set(selectedInvoiceIds);
    if (newSelected.has(invoiceId)) {
      newSelected.delete(invoiceId);
    } else {
      newSelected.add(invoiceId);
    }
    setSelectedInvoiceIds(newSelected);
  };

  // Exit select mode
  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedInvoiceIds(new Set());
  };

  const handleBulkDelete = () => {
    const idsToDelete = Array.from(selectedInvoiceIds);
    bulkDeleteMutation.mutate(idsToDelete);
  };

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

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
          All Invoices ({invoices.length})
        </h3>
        <div className="flex items-center gap-2">
          {isSelectMode ? (
            <Button 
              variant="outline" 
              size="icon"
              onClick={exitSelectMode}
              className="h-10 w-10 bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50"
            >
              <X className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </Button>
          ) : (
            <>
              {invoices.length > 0 && canManageInvoices && (
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setIsSelectMode(true)}
                  className="h-10 w-10"
                >
                  <CheckSquare className="h-5 w-5" />
                </Button>
              )}
              {canCreateInvoice && (
                <Button 
                  id="add-invoice-pill"
                  data-testid="add-invoice-pill"
                  onClick={() => setIsSheetOpen(true)}
                  className="rounded-full px-4 flex-shrink-0"
                >
                  <Plus className="w-[18px] h-[18px] mr-2" />
                  Add Invoice
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Search Bar */}
      {invoices.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search invoices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10 h-10 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 rounded-lg"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500 transition-colors"
            >
              <X className="h-3 w-3 text-slate-600 dark:text-slate-300" />
            </button>
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      {isSelectMode && (
        <div className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {selectedInvoiceIds.size} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedInvoiceIds.size === 0}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Delete
          </Button>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedInvoiceIds.size} invoice{selectedInvoiceIds.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected invoice{selectedInvoiceIds.size > 1 ? 's' : ''}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No invoices yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start billing your clients by creating your first invoice.
            </p>
            {canCreateInvoice && (
              <Button 
                onClick={() => setIsSheetOpen(true)}
                className="rounded-full px-4"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Invoice
              </Button>
            )}
          </CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No invoices found</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Try adjusting your search terms
            </p>
            <Button 
              variant="outline"
              onClick={() => setSearchQuery("")}
              className="rounded-full px-4"
            >
              Clear Search
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredInvoices.map((invoice: any) => (
            <Card 
              key={invoice.id} 
              className={`hover:shadow-md transition-shadow cursor-pointer ${
                isSelectMode && selectedInvoiceIds.has(invoice.id) 
                  ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500' 
                  : ''
              }`}
              onClick={() => {
                if (isSelectMode) {
                  toggleInvoiceSelection(invoice.id);
                } else {
                  setLocation(`/invoicing/${invoice.id}`);
                }
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {isSelectMode && (
                      <div 
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedInvoiceIds.has(invoice.id)
                            ? 'bg-blue-600 border-blue-600'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {selectedInvoiceIds.has(invoice.id) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                    )}
                    {!isSelectMode && <FileText className="h-5 w-5 text-slate-600 dark:text-slate-400" />}
                    {invoice.invoiceNumber || `Invoice #${invoice.id}`}
                  </CardTitle>
                  <Badge variant={getStatusBadgeVariant(invoice.status)}>
                    {invoice.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {(() => {
                  // Resolve customer display name with priority order
                  let displayName = 'Unknown Customer';
                  if (invoice.customer?.companyName) {
                    displayName = invoice.customer.companyName;
                  } else if (invoice.customer) {
                    const fullName = `${invoice.customer.firstName || ''} ${invoice.customer.lastName || ''}`.trim();
                    if (fullName) displayName = fullName;
                  } else if ((invoice as any).job?.customer?.companyName) {
                    displayName = (invoice as any).job.customer.companyName;
                  } else if ((invoice as any).job?.customer) {
                    const jobCust = (invoice as any).job.customer;
                    const fullName = `${jobCust.firstName || ''} ${jobCust.lastName || ''}`.trim();
                    if (fullName) displayName = fullName;
                  } else if (invoice.client?.name) {
                    displayName = invoice.client.name;
                  } else if ((invoice as any).job?.clientName) {
                    displayName = (invoice as any).job.clientName;
                  }
                  console.log("[Invoice UI] Display name resolved as:", displayName);
                  return (
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {displayName}
                    </p>
                  );
                })()}
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
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-4 w-4" />
                    View PDF
                  </a>
                )}
                {((invoice.tags as string[] | null)?.length ?? 0) > 0 && (
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
