import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { NewJobSheet } from "@/components/NewJobSheet";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface JobEditProps {
  jobId: string;
}

export default function JobEdit({ jobId }: JobEditProps) {
  const [, navigate] = useLocation();
  
  // GET /api/jobs/:id now returns fully hydrated job with customer, lineItems, assignedEmployeeIds
  const { data: job, isLoading, error } = useQuery<any>({
    queryKey: [`/api/jobs/${jobId}`],
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Job not found</h2>
          <Button onClick={() => navigate('/jobs')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  // Job is now fully hydrated from API with customer, lineItems, assignedEmployeeIds
  return (
    <NewJobSheet
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          navigate('/jobs');
        }
      }}
      initialJob={job}
      isEditMode={true}
      onJobUpdated={() => {
        navigate(`/jobs/${jobId}`);
      }}
    />
  );
}
