import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, UserCheck, Mail, Phone, Star, Edit, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertSubcontractorSchema, type InsertSubcontractor, type Subcontractor } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function SubcontractorForm({ 
  onSubmit, 
  isLoading, 
  initialData, 
  isEdit 
}: { 
  onSubmit: (data: InsertSubcontractor) => void; 
  isLoading: boolean; 
  initialData?: any;
  isEdit?: boolean;
}) {
  const form = useForm<InsertSubcontractor>({
    resolver: zodResolver(insertSubcontractorSchema),
    defaultValues: {
      name: initialData?.name || "",
      email: initialData?.email || "",
      phone: initialData?.phone || "",
      skills: initialData?.skills || [],
      isAvailable: initialData?.isAvailable !== undefined ? initialData.isAvailable : true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="John Smith" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="john@contractor.com" {...field} value={field.value || ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Skills & Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Plumbing, Electrical, Carpentry..." {...field} value={field.value || ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Adding..." : "Add Subcontractor"}
        </Button>
      </form>
    </Form>
  );
}

export default function Subcontractors() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState(null);

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

  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery({
    queryKey: ["/api/subcontractors"],
    enabled: isAuthenticated,
  });

  const createSubcontractorMutation = useMutation({
    mutationFn: async (subcontractorData: InsertSubcontractor) => {
      const res = await apiRequest("POST", "/api/subcontractors", subcontractorData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Subcontractor added successfully",
      });
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
      toast({
        title: "Success",
        description: "Subcontractor updated successfully!",
      });
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
      toast({
        title: "Success",
        description: "Subcontractor deleted successfully!",
      });
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Subcontractors</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage your network of skilled subcontractors</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[350px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add New Subcontractor</DialogTitle>
          </DialogHeader>
          <SubcontractorForm onSubmit={createSubcontractorMutation.mutate} isLoading={createSubcontractorMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Edit Subcontractor Dialog */}
      <Dialog open={!!editingSubcontractor} onOpenChange={(open) => !open && setEditingSubcontractor(null)}>
        <DialogContent className="sm:max-w-[350px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit Subcontractor</DialogTitle>
          </DialogHeader>
          <SubcontractorForm 
            onSubmit={(data) => updateSubcontractorMutation.mutate({ subcontractorId: editingSubcontractor?.id, subcontractorData: data })} 
            isLoading={updateSubcontractorMutation.isPending}
            initialData={editingSubcontractor}
            isEdit={true}
          />
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Subcontractors ({subcontractors.length})
        </h3>
      </div>

      {subcontractors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <UserCheck className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No subcontractors yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Build your network by adding trusted subcontractors.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Subcontractor
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {subcontractors.map((subcontractor: any) => (
            <Card key={subcontractor.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  {subcontractor.name}
                </CardTitle>
                <Badge variant={subcontractor.isAvailable ? 'default' : 'secondary'}>
                  {subcontractor.isAvailable ? 'Available' : 'Busy'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {subcontractor.skills && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {subcontractor.skills}
                  </p>
                )}
                {subcontractor.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Mail className="h-4 w-4" />
                    {subcontractor.email}
                  </div>
                )}
                {subcontractor.phone && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Phone className="h-4 w-4" />
                    {subcontractor.phone}
                  </div>
                )}
                {subcontractor.rating && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Star className="h-4 w-4" />
                    {subcontractor.rating}/5 rating
                  </div>
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
                          <AlertDialogTitle>Delete Subcontractor</AlertDialogTitle>
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