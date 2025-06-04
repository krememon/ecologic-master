import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  DollarSign, 
  Users, 
  TrendingUp,
  AlertTriangle,
  Clock,
  CheckCircle,
  Plus,
  UserPlus,
  FileText
} from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ["/api/jobs"],
  });

  if (statsLoading || jobsLoading) {
    return (
      <div className="responsive-container space-y-4 sm:space-y-6">
        <div className="responsive-grid">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 sm:p-6">
                <div className="h-16 sm:h-20 bg-slate-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "in_progress":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "planning":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "urgent":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "in_progress":
        return <Building2 className="w-5 h-5 text-blue-600" />;
      case "planning":
        return <Clock className="w-5 h-5 text-orange-600" />;
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "urgent":
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <Building2 className="w-5 h-5 text-gray-600" />;
    }
  };

  const recentJobs = jobs?.slice(0, 4) || [];

  return (
    <div className="p-6 space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Active Jobs</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                  {stats?.activeJobs || 0}
                </p>
                <p className="text-sm text-green-600 dark:text-green-400 mt-2 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  <span>+12% from last month</span>
                </p>
              </div>
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Outstanding Invoices</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                  ${stats?.outstandingInvoices?.amount?.toLocaleString() || 0}
                </p>
                <p className="text-sm text-orange-600 dark:text-orange-400 mt-2 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  <span>{stats?.outstandingInvoices?.count || 0} overdue</span>
                </p>
              </div>
              <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-full">
                <DollarSign className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Available Subcontractors</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                  {stats?.availableSubcontractors || 0}
                </p>
                <p className="text-sm text-green-600 dark:text-green-400 mt-2 flex items-center">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span>15 rated 5 stars</span>
                </p>
              </div>
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                <Users className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">This Month's Revenue</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                  ${stats?.monthlyRevenue?.toLocaleString() || 0}
                </p>
                <p className="text-sm text-green-600 dark:text-green-400 mt-2 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  <span>+18% vs last month</span>
                </p>
              </div>
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                <DollarSign className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Jobs */}
        <div className="lg:col-span-2">
          <Card className="border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recent Jobs</h3>
                <Button variant="link" className="text-blue-600 dark:text-blue-400">
                  View All
                </Button>
              </div>
            </div>
            <CardContent className="p-6">
              <div className="space-y-4">
                {recentJobs.length === 0 ? (
                  <p className="text-slate-600 dark:text-slate-400 text-center py-8">
                    No jobs found. Create your first job to get started.
                  </p>
                ) : (
                  recentJobs.map((job: any) => (
                    <div key={job.id} className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                          {getStatusIcon(job.status)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{job.title}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">{job.client?.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(job.status)}>
                          {job.status.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                        </Badge>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                          Due {job.endDate ? new Date(job.endDate).toLocaleDateString() : 'TBD'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Alerts */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card className="border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quick Actions</h3>
            </div>
            <CardContent className="p-6 space-y-4">
              <Button className="w-full" variant="default">
                <Plus className="w-5 h-5 mr-2" />
                Create New Job
              </Button>
              
              <Button className="w-full" variant="outline">
                <UserPlus className="w-5 h-5 mr-2" />
                Add Subcontractor
              </Button>

              <Button className="w-full" variant="outline">
                <FileText className="w-5 h-5 mr-2" />
                Generate Invoice
              </Button>
            </CardContent>
          </Card>

          {/* Alerts & Notifications */}
          <Card className="border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recent Alerts</h3>
            </div>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start space-x-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Payment Overdue</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Invoice #INV-2024-0156 is 15 days overdue</p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Schedule Conflict</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Two jobs scheduled for same crew tomorrow</p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Job Completed</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Downtown Office Renovation marked complete</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Schedule Overview */}
      <Card className="border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">This Week's Schedule</h3>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                Previous
              </Button>
              <Button variant="outline" size="sm">
                Next
              </Button>
            </div>
          </div>
        </div>
        <CardContent className="p-6">
          <div className="grid grid-cols-7 gap-4">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
              <div key={day} className="text-center">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-3">{day}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
                  Dec {9 + index}
                </p>
                <div className="space-y-2">
                  {index < 5 && (
                    <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded text-xs text-blue-800 dark:text-blue-200 font-medium">
                      {index === 0 ? 'Office Reno' : 
                       index === 1 ? 'Site Inspection' :
                       index === 2 ? 'Emergency Repair' :
                       index === 3 ? 'Flooring' : 'Final Walkthrough'}
                    </div>
                  )}
                  {index < 2 && (
                    <div className="p-2 bg-green-100 dark:bg-green-900 rounded text-xs text-green-800 dark:text-green-200 font-medium">
                      Kitchen Install
                    </div>
                  )}
                  {index >= 5 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">No jobs scheduled</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
