import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, FileText, Trash2, Loader2, MoreVertical, Eye, Edit, Copy } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Estimate, EstimateItem } from "@shared/schema";

interface LineItem {
  name: string;
  quantity: string;
  unitPriceCents: number;
}

interface JobEstimatesTabProps {
  jobId: number;
  canCreate: boolean;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft': return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
    case 'sent': return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'accepted': return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'rejected': return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    default: return 'bg-slate-100 text-slate-700';
  }
}

export default function JobEstimatesTab({ jobId, canCreate }: JobEstimatesTabProps) {
  const { toast } = useToast();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [estimateToDelete, setEstimateToDelete] = useState<Estimate | null>(null);
  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [taxInput, setTaxInput] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: "", quantity: "1", unitPriceCents: 0 }
  ]);

  const { data: estimates = [], isLoading } = useQuery<Estimate[]>({
    queryKey: ['/api/jobs', jobId, 'estimates'],
  });

  const createEstimateMutation = useMutation({
    mutationFn: async (data: { title: string; customerName?: string; customerEmail?: string; notes?: string; taxCents: number; items: LineItem[] }) => {
      return await apiRequest("POST", `/api/jobs/${jobId}/estimates`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'estimates'] });
      setIsCreateModalOpen(false);
      resetForm();
      toast({
        title: "Estimate Created",
        description: "The estimate has been saved as a draft.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const deleteEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      return await apiRequest("DELETE", `/api/estimates/${estimateId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'estimates'] });
      setEstimateToDelete(null);
      toast({
        title: "Estimate Deleted",
        description: "The estimate has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete estimate",
        variant: "destructive",
      });
    },
  });

  const duplicateEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      return await apiRequest("POST", `/api/estimates/${estimateId}/duplicate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'estimates'] });
      toast({
        title: "Estimate Duplicated",
        description: "A copy of the estimate has been created.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate estimate",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setTitle("");
    setCustomerName("");
    setCustomerEmail("");
    setNotes("");
    setTaxInput("");
    setLineItems([{ name: "", quantity: "1", unitPriceCents: 0 }]);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { name: "", quantity: "1", unitPriceCents: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    if (field === 'unitPriceCents') {
      updated[index][field] = typeof value === 'number' ? value : Math.round(parseFloat(value) * 100) || 0;
    } else {
      updated[index][field] = value as string;
    }
    setLineItems(updated);
  };

  const calculateLineTotal = (item: LineItem): number => {
    const qty = parseFloat(item.quantity) || 0;
    return Math.round(qty * item.unitPriceCents);
  };

  const calculateSubtotal = (): number => {
    return lineItems.reduce((sum, item) => sum + calculateLineTotal(item), 0);
  };

  const calculateTaxCents = (): number => {
    const taxValue = parseFloat(taxInput) || 0;
    return Math.round(taxValue * 100);
  };

  const calculateTotal = (): number => {
    return calculateSubtotal() + calculateTaxCents();
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast({
        title: "Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    const validItems = lineItems.filter(item => item.name.trim());
    if (validItems.length === 0) {
      toast({
        title: "Error",
        description: "At least one line item with a name is required",
        variant: "destructive",
      });
      return;
    }

    createEstimateMutation.mutate({
      title: title.trim(),
      customerName: customerName.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      notes: notes.trim() || undefined,
      taxCents: calculateTaxCents(),
      items: validItems,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Estimates</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
            data-testid="button-create-estimate"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Create Estimate
          </Button>
        )}
      </div>

      {/* Estimates List */}
      {estimates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <FileText className="h-7 w-7 text-slate-400" />
            </div>
            <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-1">No estimates yet</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Create an estimate for this job</p>
            {canCreate && (
              <Button
                size="sm"
                onClick={() => setIsCreateModalOpen(true)}
                data-testid="button-create-estimate-empty"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Create Estimate
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {estimates.map((estimate) => (
            <Card key={estimate.id} className="hover:shadow-sm transition-shadow" data-testid={`card-estimate-${estimate.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono text-slate-500 dark:text-slate-400">
                        {estimate.estimateNumber}
                      </span>
                      <Badge className={`text-xs ${getStatusColor(estimate.status)}`}>
                        {estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)}
                      </Badge>
                    </div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {estimate.title}
                    </h4>
                    {estimate.updatedAt && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Updated {format(new Date(estimate.updatedAt), 'MMM d, yyyy')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(estimate.totalCents)}
                    </p>
                    {canCreate && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-estimate-actions-${estimate.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => {
                              toast({
                                title: "View Estimate",
                                description: `Viewing ${estimate.estimateNumber} - Detail view coming soon`,
                              });
                            }}
                            data-testid={`action-view-estimate-${estimate.id}`}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          {estimate.status === 'draft' && (
                            <DropdownMenuItem 
                              onClick={() => {
                                toast({
                                  title: "Edit Estimate",
                                  description: `Editing ${estimate.estimateNumber} - Edit functionality coming soon`,
                                });
                              }}
                              data-testid={`action-edit-estimate-${estimate.id}`}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem 
                            onClick={() => duplicateEstimateMutation.mutate(estimate.id)}
                            disabled={duplicateEstimateMutation.isPending}
                            data-testid={`action-duplicate-estimate-${estimate.id}`}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          {estimate.status === 'draft' && (
                            <DropdownMenuItem 
                              onClick={() => setEstimateToDelete(estimate)}
                              className="text-red-600 dark:text-red-400"
                              data-testid={`action-delete-estimate-${estimate.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Estimate Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Estimate</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-5 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="estimate-title">Title *</Label>
              <Input
                id="estimate-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Kitchen Renovation Estimate"
                data-testid="input-estimate-title"
              />
            </div>

            {/* Customer Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer-name">Customer Name</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                  data-testid="input-customer-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-email">Customer Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="customer@example.com"
                  data-testid="input-customer-email"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="estimate-notes">Notes (optional)</Label>
              <Textarea
                id="estimate-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes or terms..."
                rows={2}
                data-testid="input-estimate-notes"
              />
            </div>

            {/* Line Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Line Items *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLineItem}
                  data-testid="button-add-line-item"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>

              <div className="space-y-3">
                {/* Header Row */}
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 px-1">
                  <div className="col-span-5">Item Name</div>
                  <div className="col-span-2">Qty</div>
                  <div className="col-span-2">Unit Price</div>
                  <div className="col-span-2 text-right">Total</div>
                  <div className="col-span-1"></div>
                </div>

                {/* Line Items */}
                {lineItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <Input
                        value={item.name}
                        onChange={(e) => updateLineItem(index, 'name', e.target.value)}
                        placeholder="Item name"
                        data-testid={`input-item-name-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                        placeholder="1"
                        min="0"
                        step="0.01"
                        data-testid={`input-item-qty-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <Input
                          type="number"
                          value={(item.unitPriceCents / 100).toFixed(2)}
                          onChange={(e) => updateLineItem(index, 'unitPriceCents', e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          className="pl-6"
                          data-testid={`input-item-price-${index}`}
                        />
                      </div>
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium text-slate-700 dark:text-slate-300">
                      {formatCurrency(calculateLineTotal(item))}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLineItem(index)}
                        disabled={lineItems.length === 1}
                        className="h-8 w-8"
                        data-testid={`button-remove-item-${index}`}
                      >
                        <Trash2 className="h-4 w-4 text-slate-400" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Section */}
              <div className="pt-3 border-t space-y-2">
                <div className="flex justify-end items-center">
                  <span className="text-sm text-slate-500 dark:text-slate-400 mr-4 w-20 text-right">Subtotal:</span>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24 text-right">
                    {formatCurrency(calculateSubtotal())}
                  </span>
                </div>
                <div className="flex justify-end items-center">
                  <span className="text-sm text-slate-500 dark:text-slate-400 mr-4 w-20 text-right">Tax:</span>
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <Input
                      type="number"
                      value={taxInput}
                      onChange={(e) => setTaxInput(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="pl-6 h-8 text-sm"
                      data-testid="input-tax"
                    />
                  </div>
                </div>
                <div className="flex justify-end items-center pt-2 border-t">
                  <span className="text-sm text-slate-500 dark:text-slate-400 mr-4 w-20 text-right">Total:</span>
                  <span className="text-lg font-semibold text-slate-900 dark:text-slate-100 w-24 text-right">
                    {formatCurrency(calculateTotal())}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                resetForm();
              }}
              data-testid="button-cancel-estimate"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createEstimateMutation.isPending}
              data-testid="button-save-estimate"
            >
              {createEstimateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Draft'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!estimateToDelete} onOpenChange={(open) => !open && setEstimateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Estimate</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {estimateToDelete?.estimateNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => estimateToDelete && deleteEstimateMutation.mutate(estimateToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              {deleteEstimateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
