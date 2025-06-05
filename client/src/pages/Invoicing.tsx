import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FileText, DollarSign, Calendar } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertInvoiceSchema, type InsertInvoice, type Invoice } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorBoundary, InvoiceErrorFallback } from "@/components/ErrorBoundary";

function CreateInvoiceForm({ onSubmit, isLoading }: { onSubmit: (data: InsertInvoice) => void; isLoading: boolean }) {
  // Fetch clients for selection
  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const form = useForm<InsertInvoice>({
    resolver: zodResolver(insertInvoiceSchema),
    defaultValues: {
      invoiceNumber: "",
      clientId: undefined,
      amount: "",
      status: "pending",
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
      notes: "",
    },
  });

  const handleSubmit = async (data: any) => {
    console.log("Form submitting with data:", data);
    
    // Validate required fields
    if (!data.invoiceNumber) {
      data.invoiceNumber = `INV-${Date.now()}`;
    }
    if (!data.amount || data.amount === "") {
      console.error("Amount is required");
      return;
    }
    
    // Ensure all required fields are present and properly formatted
    const formattedData = {
      invoiceNumber: data.invoiceNumber,
      clientId: data.clientId === "none" ? null : (data.clientId ? parseInt(data.clientId) : null),
      amount: data.amount.toString(),
      status: data.status || "pending",
      issueDate: data.issueDate || new Date().toISOString().split('T')[0],
      dueDate: data.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      notes: data.notes || "",
    };
    
    console.log("Formatted data being sent:", formattedData);
    
    try {
      await onSubmit(formattedData);
    } catch (error) {
      console.error("Submit error:", error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="invoiceNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Invoice Number</FormLabel>
              <FormControl>
                <Input placeholder="INV-001" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client {(!clients || clients.length === 0) && "(Optional - no clients added yet)"}</FormLabel>
              <Select onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} defaultValue={field.value?.toString()}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={(!clients || clients.length === 0) ? "No clients available" : "Select a client"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">No client</SelectItem>
                  {clients && Array.isArray(clients) && clients.length > 0 && (
                    clients.map((client: any) => (
                      <SelectItem key={client?.id || 'unknown'} value={client?.id?.toString() || 'unknown'}>
                        {client?.name || 'Unknown Client'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl>
                <Input 
                  type="text" 
                  placeholder="1500.00" 
                  {...field}
                  onChange={(e) => {
                    // Ensure we store as string for the schema
                    field.onChange(e.target.value);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="issueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Issue Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Due Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Payment terms and additional notes..." {...field} value={field.value || ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button 
          type="button" 
          className="w-full" 
          disabled={isLoading}
          onClick={async () => {
            console.log("Submit button clicked");
            const values = form.getValues();
            console.log("Form values:", values);
            
            const isValid = await form.trigger();
            console.log("Form is valid:", isValid);
            console.log("Form errors:", form.formState.errors);
            
            if (isValid) {
              await handleSubmit(values);
            } else {
              console.log("Validation failed, errors:", form.formState.errors);
            }
          }}
        >
          {isLoading ? "Creating..." : "Create Invoice"}
        </Button>
      </form>
    </Form>
  );
}

export default function Invoicing() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoiceData: InsertInvoice) => {
      console.log("Sending invoice data:", invoiceData);
      try {
        const res = await apiRequest("POST", "/api/invoices", invoiceData);
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        return await res.json();
      } catch (error) {
        console.error("Invoice creation failed:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Invoice created successfully",
      });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      console.error("Invoice creation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
      // Don't close the dialog on error so user can try again
    },
  });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Invoicing</h1>
        <p className="text-slate-600 dark:text-slate-400">Create and manage invoices for your projects</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[350px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Generate New Invoice</DialogTitle>
          </DialogHeader>
          <ErrorBoundary fallback={InvoiceErrorFallback}>
            <CreateInvoiceForm onSubmit={createInvoiceMutation.mutate} isLoading={createInvoiceMutation.isPending} />
          </ErrorBoundary>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Invoices ({invoices.length})
        </h3>
        <Button onClick={() => {
          console.log("Create Invoice button clicked");
          setIsDialogOpen(true);
        }}>
          <Plus className="w-4 h-4 mr-2" />
          Create Invoice
        </Button>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No invoices yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start billing your clients by creating your first invoice.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Invoice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {invoices.map((invoice: any) => (
            <Card key={invoice.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  Invoice #{invoice.id}
                </CardTitle>
                <Badge variant={invoice.status === 'paid' ? 'default' : 'secondary'}>
                  {invoice.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoice.client && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {invoice.client.name}
                  </p>
                )}
                {invoice.amount && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <DollarSign className="h-4 w-4" />
                    ${invoice.amount.toLocaleString()}
                  </div>
                )}
                {invoice.dueDate && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    Due: {new Date(invoice.dueDate).toLocaleDateString()}
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