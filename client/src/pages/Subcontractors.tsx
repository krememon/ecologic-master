import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSubcontractorSchema } from "@shared/schema";
import { z } from "zod";
import { Plus, Users, Star, Phone, Mail, DollarSign } from "lucide-react";

const subcontractorFormSchema = insertSubcontractorSchema.extend({
  skills: z.string().optional(),
});

type SubcontractorFormData = z.infer<typeof subcontractorFormSchema>;

export default function Subcontractors() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Redirect to home if not authenticated
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

  const { data: subcontractors, isLoading: subcontractorsLoading } = useQuery({
    queryKey: ["/api/subcontractors"],
    enabled: isAuthenticated,
  });

  const form = useForm<SubcontractorFormData>({
    resolver: zodResolver(subcontractorFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      skills: "",
      rating: "0",
      isAvailable: true,
      hourlyRate: "0",
      notes: "",
    },
  });

  const createSubcontractorMutation = useMutation({
    mutationFn: async (data: SubcontractorFormData) => {
      const skillsArray = data.skills ? data.skills.split(',').map(s => s.trim()).filter(s => s) : [];
      const formattedData = {
        ...data,
        skills: skillsArray,
        rating: data.rating ? Number(data.rating) : null,
        hourlyRate: data.hourlyRate ? Number(data.hourlyRate) : null,
      };
      await apiRequest("POST", "/api/subcontractors", formattedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      toast({
        title: "Success",
        description: "Subcontractor added successfully",
      });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to add subcontractor",
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
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar user={user} company={user?.company} />
      <main className="flex-1 overflow-auto">
        <Header 
          title="Subcontractors"
          subtitle="Manage your network of trusted subcontractors"
          user={user}
        />
        
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                All Subcontractors ({subcontractors?.length || 0})
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Manage your trusted network of skilled professionals
              </p>
            </div>
            
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Subcontractor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add New Subcontractor</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((data) => createSubcontractorMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter subcontractor name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="email@example.com" {...field} />
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
                              <Input placeholder="(555) 123-4567" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="skills"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Skills</FormLabel>
                          <FormControl>
                            <Input placeholder="Plumbing, Electrical, Carpentry (comma separated)" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="rating"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rating (0-5)</FormLabel>
                            <FormControl>
                              <Input type="number" min="0" max="5" step="0.1" placeholder="0" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="hourlyRate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hourly Rate ($)</FormLabel>
                            <FormControl>
                              <Input type="number" min="0" step="0.01" placeholder="0.00" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="isAvailable"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">
                              Available for Work
                            </FormLabel>
                            <div className="text-sm text-muted-foreground">
                              Mark if this subcontractor is currently available for new projects
                            </div>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Additional notes about this subcontractor" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="flex justify-end space-x-2">
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createSubcontractorMutation.isPending}>
                        {createSubcontractorMutation.isPending ? "Adding..." : "Add Subcontractor"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {subcontractors?.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Users className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  No subcontractors found
                </h3>
                <p className="text-slate-600 dark:text-slate-400 mb-6">
                  Add your first subcontractor to start building your network.
                </p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Subcontractor
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {subcontractors?.map((subcontractor: any) => (
                <Card key={subcontractor.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg font-semibold">{subcontractor.name}</CardTitle>
                      <div className="flex items-center gap-2">
                        {subcontractor.isAvailable ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                            Available
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            Busy
                          </Badge>
                        )}
                        {subcontractor.rating && (
                          <div className="flex items-center text-sm text-yellow-600">
                            <Star className="w-4 h-4 mr-1 fill-current" />
                            {Number(subcontractor.rating).toFixed(1)}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {subcontractor.email && (
                        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                          <Mail className="w-4 h-4 mr-2" />
                          {subcontractor.email}
                        </div>
                      )}
                      
                      {subcontractor.phone && (
                        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                          <Phone className="w-4 h-4 mr-2" />
                          {subcontractor.phone}
                        </div>
                      )}
                      
                      {subcontractor.hourlyRate && (
                        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                          <DollarSign className="w-4 h-4 mr-2" />
                          ${Number(subcontractor.hourlyRate).toFixed(2)}/hour
                        </div>
                      )}
                      
                      {subcontractor.skills && subcontractor.skills.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">Skills:</p>
                          <div className="flex flex-wrap gap-1">
                            {subcontractor.skills.map((skill: string, index: number) => (
                              <Badge key={index} variant="outline" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {subcontractor.notes && (
                        <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                          {subcontractor.notes}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
