import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, Calendar, DollarSign, MapPin } from "lucide-react";

export default function Jobs() {
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

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  if (isLoading || !isAuthenticated || jobsLoading) {
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Jobs Management</h1>
          <p className="text-slate-600 dark:text-slate-400">Manage all your construction projects and track their progress</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Job
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Jobs ({jobs.length})
        </h3>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No jobs yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start by creating your first construction project.
            </p>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Job
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job: any) => (
            <Card key={job.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  {job.title}
                </CardTitle>
                <Badge variant={job.status === 'active' ? 'default' : 'secondary'}>
                  {job.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {job.client && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Building2 className="h-4 w-4" />
                    {job.client.name}
                  </div>
                )}
                {job.location && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <MapPin className="h-4 w-4" />
                    {job.location}
                  </div>
                )}
                {job.budget && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <DollarSign className="h-4 w-4" />
                    ${job.budget.toLocaleString()}
                  </div>
                )}
                {job.startDate && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    {new Date(job.startDate).toLocaleDateString()}
                  </div>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    Created {new Date(job.createdAt).toLocaleDateString()}
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