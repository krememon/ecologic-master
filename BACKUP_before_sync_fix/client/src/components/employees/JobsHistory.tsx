import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface JobsSummary {
  total: number;
  scheduled: number;
  inProgress: number;
  completed: number;
}

interface JobsHistoryProps {
  userId: string;
}

export default function JobsHistory({ userId }: JobsHistoryProps) {
  const { data: summary, isLoading } = useQuery<JobsSummary>({
    queryKey: [`/api/users/${userId}/jobs/summary`],
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <div className="mt-3 animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
      </div>
    );
  }

  if (!summary || summary.total === 0) {
    return (
      <div className="mt-3 py-2">
        <p className="text-xs text-slate-500 italic">No jobs assigned yet</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3" data-testid={`jobs-history-${userId}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {summary.scheduled > 0 && (
          <Badge 
            variant="secondary" 
            className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            data-testid={`badge-scheduled-${userId}`}
          >
            Scheduled: {summary.scheduled}
          </Badge>
        )}
        {summary.inProgress > 0 && (
          <Badge 
            variant="secondary" 
            className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
            data-testid={`badge-in-progress-${userId}`}
          >
            In Progress: {summary.inProgress}
          </Badge>
        )}
        {summary.completed > 0 && (
          <Badge 
            variant="secondary" 
            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            data-testid={`badge-completed-${userId}`}
          >
            Completed: {summary.completed}
          </Badge>
        )}
      </div>
      
      <Link href={`/jobs?assignedTo=${userId}`}>
        <Button 
          variant="link" 
          className="p-0 h-auto text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          data-testid={`link-view-all-jobs-${userId}`}
        >
          View all jobs
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </Link>
    </div>
  );
}
