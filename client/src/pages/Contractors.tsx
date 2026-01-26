import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, UserCheck, Mail, Phone, Edit, Trash2, Globe, Building2, Search, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertSubcontractorSchema, type InsertSubcontractor, type Subcontractor } from "@shared/schema";
import { formatPhoneInput } from "@shared/phoneUtils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";

function normalizeWebsite(url: string): string {
  if (!url) return '';
  let normalized = url.trim();
  if (normalized && !normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  return normalized;
}

function ContractorForm({ 
  onSubmit, 
  isLoading, 
  initialData, 
  isEdit 
}: { 
  onSubmit: (data: any) => void; 
  isLoading: boolean; 
  initialData?: any;
  isEdit?: boolean;
}) {
  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    companyName: initialData?.companyName || "",
    companyWebsite: initialData?.companyWebsite || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const processedData = {
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      companyName: formData.companyName || null,
      companyWebsite: normalizeWebsite(formData.companyWebsite) || null,
    };
    
    onSubmit(processedData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 w-full">
      <div className="space-y-1.5">
        <label className="text-sm font-medium block">Name <span className="text-red-500">*</span></label>
        <Input 
          placeholder="John Smith" 
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          required
        />
      </div>
      
      <div className="space-y-1.5">
        <label className="text-sm font-medium block">Email</label>
        <Input 
          type="email" 
          placeholder="john@contractor.com" 
          value={formData.email}
          onChange={(e) => setFormData({...formData, email: e.target.value})}
        />
      </div>
      
      <div className="space-y-1.5">
        <label className="text-sm font-medium block">Phone</label>
        <Input 
          placeholder="555-123-4567" 
          value={formData.phone}
          onChange={(e) => setFormData({...formData, phone: formatPhoneInput(e.target.value)})}
          inputMode="numeric"
          autoComplete="tel"
        />
      </div>
      
      <div className="space-y-1.5">
        <label className="text-sm font-medium block">Company Name</label>
        <Input 
          placeholder="ABC Plumbing LLC" 
          value={formData.companyName}
          onChange={(e) => setFormData({...formData, companyName: e.target.value})}
        />
      </div>
      
      <div className="space-y-1.5">
        <label className="text-sm font-medium block">Company Website</label>
        <Input 
          placeholder="www.example.com" 
          value={formData.companyWebsite}
          onChange={(e) => setFormData({...formData, companyWebsite: e.target.value})}
        />
      </div>
      
      <Button type="submit" className="w-full mt-4" disabled={isLoading}>
        {isLoading ? "Saving..." : (isEdit ? "Update Contractor" : "Add Contractor")}
      </Button>
    </form>
  );
}

export default function Contractors() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState<Subcontractor | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontractors"],
    enabled: isAuthenticated,
  });

  const filteredSubcontractors = subcontractors.filter((sub) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      sub.name?.toLowerCase().includes(query) ||
      sub.companyName?.toLowerCase().includes(query) ||
      sub.email?.toLowerCase().includes(query) ||
      sub.phone?.toLowerCase().includes(query)
    );
  });

  const createSubcontractorMutation = useMutation({
    mutationFn: async (subcontractorData: InsertSubcontractor) => {
      const res = await apiRequest("POST", "/api/subcontractors", subcontractorData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSubcontractorMutation = useMutation({
    mutationFn: async ({ subcontractorId, subcontractorData }: { subcontractorId: number, subcontractorData: InsertSubcontractor }) => {
      const res = await apiRequest("PATCH", `/api/subcontractors/${subcontractorId}`, subcontractorData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      setEditingSubcontractor(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSubcontractorMutation = useMutation({
    mutationFn: async (subcontractorId: number) => {
      await apiRequest("DELETE", `/api/subcontractors/${subcontractorId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading || !isAuthenticated || subcontractorsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Contractors</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage your network of skilled contractors</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-[95vw] max-w-[400px] max-h-[85vh] rounded-2xl overflow-y-auto p-5 pt-4 gap-3">
          <DialogHeader className="pb-1">
            <DialogTitle>Add New Contractor</DialogTitle>
          </DialogHeader>
          <ContractorForm onSubmit={createSubcontractorMutation.mutate} isLoading={createSubcontractorMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Edit Contractor Dialog */}
      <Dialog open={!!editingSubcontractor} onOpenChange={(open) => !open && setEditingSubcontractor(null)}>
        <DialogContent className="w-[95vw] max-w-[400px] max-h-[85vh] rounded-2xl overflow-y-auto p-5 pt-4 gap-3">
          <DialogHeader className="pb-1">
            <DialogTitle>Edit Contractor</DialogTitle>
          </DialogHeader>
          <ContractorForm 
            onSubmit={(data) => updateSubcontractorMutation.mutate({ subcontractorId: editingSubcontractor!.id, subcontractorData: data })} 
            isLoading={updateSubcontractorMutation.isPending}
            initialData={editingSubcontractor}
            isEdit={true}
          />
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Contractors ({subcontractors.length})
        </h3>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add New Contractor
        </Button>
      </div>

      {subcontractors.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search contractors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {subcontractors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <UserCheck className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No contractors yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Build your network by adding trusted contractors.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Contractor
            </Button>
          </CardContent>
        </Card>
      ) : filteredSubcontractors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No contractors found</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center">
              Try a different search
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSubcontractors.map((subcontractor: any) => (
            <Card key={subcontractor.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  {subcontractor.name}
                </CardTitle>
                {subcontractor.companyName && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {subcontractor.companyName}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {subcontractor.email && (
                  <a 
                    href={`mailto:${subcontractor.email}`}
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    <Mail className="h-4 w-4" />
                    {subcontractor.email}
                  </a>
                )}
                {subcontractor.phone && (
                  <a 
                    href={`tel:${subcontractor.phone}`}
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    <Phone className="h-4 w-4" />
                    {subcontractor.phone}
                  </a>
                )}
                {subcontractor.companyWebsite && (
                  <a 
                    href={subcontractor.companyWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    <Globe className="h-4 w-4" />
                    Website
                  </a>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <p className="text-xs text-slate-500">
                    Added {new Date(subcontractor.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                      onClick={() => setEditingSubcontractor(subcontractor)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="sm:max-w-[350px] rounded-2xl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Contractor</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{subcontractor.name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => deleteSubcontractorMutation.mutate(subcontractor.id)}
                            className="bg-red-600 hover:bg-red-700"
                            disabled={deleteSubcontractorMutation.isPending}
                          >
                            {deleteSubcontractorMutation.isPending ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}