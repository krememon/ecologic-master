import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, UserCheck, Mail, Phone, Star } from "lucide-react";

export default function Subcontractors() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();

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

  if (isLoading || !isAuthenticated || subcontractorsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Subcontractors</h1>
          <p className="text-slate-600 dark:text-slate-400">Manage your network of skilled subcontractors</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Subcontractor
        </Button>
      </div>

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
            <Button>
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
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    Added {new Date(subcontractor.createdAt).toLocaleDateString()}
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