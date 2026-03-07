import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar, Clock, Users, AlertTriangle, CheckCircle, Play, Pause, MoreHorizontal } from "lucide-react";
import { useState } from "react";

interface ProjectTimelineProps {
  jobs: any[];
  subcontractors: any[];
}

export function ProjectTimeline({ jobs, subcontractors }: ProjectTimelineProps) {
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [timeView, setTimeView] = useState<'week' | 'month' | 'quarter'>('month');

  // Generate timeline data
  const generateTimelineData = () => {
    const today = new Date();
    const timelineJobs = jobs.map(job => {
      const startDate = new Date(job.startDate || today);
      const endDate = new Date(job.endDate || new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000));
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysPassed = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const progress = Math.max(0, Math.min(100, (daysPassed / totalDays) * 100));

      return {
        ...job,
        startDate,
        endDate,
        totalDays,
        daysPassed,
        progress: job.status === 'completed' ? 100 : progress,
        isOverdue: today > endDate && job.status !== 'completed',
        daysRemaining: Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
      };
    });

    return timelineJobs.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  };

  const timelineJobs = generateTimelineData();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'active': return 'bg-blue-600';
      case 'on_hold': return 'bg-yellow-500';
      case 'planning': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  const getStatusBadge = (job: any) => {
    if (job.isOverdue) {
      return <Badge variant="destructive" className="text-xs">Overdue</Badge>;
    }
    if (job.status === 'completed') {
      return <Badge variant="default" className="text-xs bg-green-600">Completed</Badge>;
    }
    if (job.daysRemaining <= 3 && job.status === 'active') {
      return <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">Due Soon</Badge>;
    }
    return <Badge variant="outline" className="text-xs capitalize">{job.status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Timeline Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Project Timeline</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={timeView === 'week' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeView('week')}
          >
            Week
          </Button>
          <Button
            variant={timeView === 'month' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeView('month')}
          >
            Month
          </Button>
          <Button
            variant={timeView === 'quarter' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeView('quarter')}
          >
            Quarter
          </Button>
        </div>
      </div>

      {/* Timeline Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-600" />
            Project Gantt Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {timelineJobs.map((job, index) => (
              <div key={job.id} className="relative">
                <div className="flex items-center gap-4 p-4 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  {/* Job Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {job.title}
                      </h4>
                      {getStatusBadge(job)}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {job.startDate.toLocaleDateString()} - {job.endDate.toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {job.daysRemaining} days remaining
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {Math.floor(Math.random() * 3) + 1} assigned
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-48">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <span>Progress</span>
                      <span>{Math.round(job.progress)}%</span>
                    </div>
                    <Progress 
                      value={job.progress} 
                      className={`h-2 ${job.isOverdue ? 'bg-red-100' : 'bg-slate-100'}`}
                    />
                  </div>

                  {/* Status Indicator */}
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(job.status)}`}></div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedJob(job)}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>{job.title} - Project Details</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <h4 className="font-medium mb-2">Timeline</h4>
                              <div className="space-y-1 text-sm">
                                <p><strong>Start:</strong> {job.startDate.toLocaleDateString()}</p>
                                <p><strong>End:</strong> {job.endDate.toLocaleDateString()}</p>
                                <p><strong>Duration:</strong> {job.totalDays} days</p>
                                <p><strong>Progress:</strong> {Math.round(job.progress)}%</p>
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium mb-2">Budget</h4>
                              <div className="space-y-1 text-sm">
                                <p><strong>Estimated:</strong> ${job.estimatedCost?.toLocaleString() || 'N/A'}</p>
                                <p><strong>Actual:</strong> ${job.actualCost?.toLocaleString() || 'N/A'}</p>
                                <p><strong>Remaining:</strong> ${((job.estimatedCost || 0) - (job.actualCost || 0)).toLocaleString()}</p>
                              </div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-medium mb-2">Description</h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              {job.description || 'No description available'}
                            </p>
                          </div>
                          <div>
                            <h4 className="font-medium mb-2">Assigned Team</h4>
                            <div className="flex gap-2">
                              {subcontractors.slice(0, 3).map((sub, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {sub.companyName || sub.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                {/* Timeline Bar Visualization */}
                <div className="ml-4 mt-2 relative">
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        job.isOverdue ? 'bg-red-500' : 
                        job.status === 'completed' ? 'bg-green-500' : 'bg-blue-600'
                      }`}
                      style={{ width: `${job.progress}%` }}
                    ></div>
                  </div>
                  {job.isOverdue && (
                    <AlertTriangle className="absolute -top-1 right-0 h-4 w-4 text-red-500" />
                  )}
                  {job.status === 'completed' && (
                    <CheckCircle className="absolute -top-1 right-0 h-4 w-4 text-green-500" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Resource Allocation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-green-600" />
            Resource Allocation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subcontractors.slice(0, 6).map((subcontractor, index) => {
              const workload = Math.floor(Math.random() * 80) + 20;
              const activeJobs = Math.floor(Math.random() * 4) + 1;
              
              return (
                <div key={subcontractor.id} className="p-4 border rounded-lg">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                      {(subcontractor.companyName || subcontractor.name).split(' ').map((n: string) => n[0]).join('')}
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-900 dark:text-slate-100">{subcontractor.companyName || subcontractor.name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{subcontractor.specialization}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Workload</span>
                      <span className={workload > 80 ? 'text-red-600' : workload > 60 ? 'text-yellow-600' : 'text-green-600'}>
                        {workload}%
                      </span>
                    </div>
                    <Progress value={workload} className="h-2" />
                    
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{activeJobs} active jobs</span>
                      <span>Rating: {subcontractor.rating || '4.5'}/5</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}