import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Loader2, ChevronLeft, Percent, Settings2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCan } from "@/hooks/useCan";

interface CompanyTax {
  id: number;
  companyId: number;
  name: string;
  ratePercent: string;
  createdAt: string;
  updatedAt: string;
}

export default function Taxes() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const [name, setName] = useState("");
  const [ratePercent, setRatePercent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: taxes = [], isLoading } = useQuery<CompanyTax[]>({
    queryKey: ['/api/company/taxes'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; ratePercent: string }) => {
      const res = await apiRequest('POST', '/api/company/taxes', data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create tax');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company/taxes'] });
      setName("");
      setRatePercent("");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/company/taxes/${id}`);
      if (!res.ok) {
        throw new Error('Failed to delete tax');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company/taxes'] });
    },
    onError: () => {
      setError("Failed to delete tax");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Tax name is required");
      return;
    }
    if (trimmedName.length < 2 || trimmedName.length > 40) {
      setError("Tax name must be 2-40 characters");
      return;
    }
    
    const rate = parseFloat(ratePercent);
    if (isNaN(rate)) {
      setError("Please enter a valid percentage");
      return;
    }
    if (rate < 0 || rate > 20) {
      setError("Rate must be between 0 and 20");
      return;
    }
    
    createMutation.mutate({ name: trimmedName, ratePercent: rate.toString() });
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
            Only Owners can manage tax settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/customize">
          <button className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-4">
            <ChevronLeft className="h-4 w-4" />
            Back to Customize
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Taxes
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Create custom tax rates to apply to invoices
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Tax Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New York Sales Tax"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="rate">Percentage</Label>
              <div className="relative mt-1">
                <Input
                  id="rate"
                  type="number"
                  step="0.001"
                  min="0"
                  max="20"
                  value={ratePercent}
                  onChange={(e) => setRatePercent(e.target.value)}
                  placeholder="8.625"
                  className="pr-8"
                />
                <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
            </div>
          </div>
          
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          
          <Button 
            type="submit" 
            disabled={createMutation.isPending}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Add Tax
          </Button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 className="font-medium text-slate-900 dark:text-slate-100">Saved Taxes</h2>
        </div>
        
        {taxes.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            No taxes created yet
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {taxes.map((tax) => (
              <div key={tax.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {tax.name}
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-4">
                  <span className="text-slate-600 dark:text-slate-400 font-mono">
                    {parseFloat(tax.ratePercent).toFixed(3)}%
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button 
                        className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Tax</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{tax.name}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => deleteMutation.mutate(tax.id)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
