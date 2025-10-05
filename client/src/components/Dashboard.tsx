import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
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
  FileText,
  Calendar,
  BarChart3,
  Brain,
  Target,
  CalendarIcon,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdvancedAnalytics } from "./AdvancedAnalytics";
import { ProjectTimeline } from "./ProjectTimeline";
import { AIJobScoping } from "./AIJobScoping";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";

// Recent Alerts Component
function RecentAlertsCard({ jobs, invoices }: { jobs: any[], invoices: any[] }) {
  const generateAlerts = () => {
    const alerts: Array<{
      id: string;
      type: 'error' | 'warning' | 'success' | 'info';
      title: string;
      message: string;
      timestamp: Date;
      icon: any;
      bgColor: string;
      borderColor: string;
      iconColor: string;
    }> = [];

    const today = new Date();
    
    // Check for overdue invoices
    if (invoices) {
      invoices.forEach((invoice: any) => {
        if (invoice.status === 'pending' && invoice.dueDate) {
          const dueDate = new Date(invoice.dueDate);
          const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysOverdue > 0) {
            alerts.push({
              id: `invoice-overdue-${invoice.id}`,
              type: 'error',
              title: 'Payment Overdue',
              message: `Invoice ${invoice.invoiceNumber} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue ($${parseFloat(invoice.amount).toLocaleString()})`,
              timestamp: dueDate,
              icon: AlertTriangle,
              bgColor: 'bg-red-50 dark:bg-red-900/20',
              borderColor: 'border-red-200 dark:border-red-800',
              iconColor: 'text-red-600 dark:text-red-400'
            });
          }
        }
      });
    }

    return alerts.slice(0, 3); // Show only top 3 alerts
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  };

  const alerts = generateAlerts();

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recent Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-sm text-slate-500 dark:text-slate-500">No alerts or issues to address</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const IconComponent = alert.icon;
              return (
                <div
                  key={alert.id}
                  className={`flex items-start space-x-3 p-3 border rounded-lg hover:shadow-sm transition-shadow ${alert.bgColor} ${alert.borderColor}`}
                >
                  <IconComponent className={`w-5 h-5 mt-0.5 ${alert.iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {alert.title}
                      </p>
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">
                        {formatTimeAgo(alert.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 break-words">
                      {alert.message}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Data queries
  const { data: jobs = [] } = useQuery({ queryKey: ["/api/jobs"] });
  const { data: invoices = [] } = useQuery({ queryKey: ["/api/invoices"] });
  const { data: subcontractors = [] } = useQuery({ queryKey: ["/api/subcontractors"] });
  const { data: stats = {} } = useQuery({ queryKey: ["/api/dashboard/stats"] });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "in_progress":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "planning":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
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

  // Filter jobs for today's date (or selected date)
  const todaysJobs = jobs?.filter((job: any) => {
    if (!job.startDate) return false;
    const jobDate = new Date(job.startDate);
    const selected = new Date(selectedDate);
    return (
      jobDate.getFullYear() === selected.getFullYear() &&
      jobDate.getMonth() === selected.getMonth() &&
      jobDate.getDate() === selected.getDate()
    );
  }) || [];

  const handlePreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const handleNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Business Dashboard</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Comprehensive project management and analytics</p>
        </div>

      </div>

      {/* Premium Tabbed Interface */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="ai-scoping" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            AI Scoping
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Simple Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Active Jobs</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                      {stats?.activeJobs || 0}
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
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Contractors</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                      {stats?.availableSubcontractors || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-full">
                    <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Pending Invoices</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                      {invoices?.filter(inv => inv.status === 'pending').length || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-full">
                    <FileText className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Jobs</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                      {stats?.totalJobs || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                    <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Today's Jobs and Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Today's Jobs</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handlePreviousDay}
                      className="h-8 w-8"
                      data-testid="button-previous-day"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="h-8 text-xs font-normal"
                          data-testid="button-date-picker"
                        >
                          <CalendarIcon className="mr-2 h-3 w-3" />
                          {format(selectedDate, "MMM d, yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <div className="p-3 space-y-2">
                          <Input
                            type="date"
                            value={format(selectedDate, "yyyy-MM-dd")}
                            onChange={(e) => setSelectedDate(new Date(e.target.value))}
                            className="w-full"
                            data-testid="input-date-select"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleToday}
                            className="w-full"
                            data-testid="button-today"
                          >
                            Today
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleNextDay}
                      className="h-8 w-8"
                      data-testid="button-next-day"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {todaysJobs.length === 0 ? (
                    <div className="text-center py-8">
                      <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-600 dark:text-slate-400">
                        No jobs scheduled for {format(selectedDate, "MMMM d, yyyy")}
                      </p>
                    </div>
                  ) : (
                    todaysJobs.map((job: any) => (
                      <div key={job.id} className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors" data-testid={`job-card-${job.id}`}>
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
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <RecentAlertsCard jobs={jobs} invoices={invoices} />
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <AdvancedAnalytics 
            jobs={jobs} 
            invoices={invoices} 
            subcontractors={subcontractors} 
            stats={stats}
          />
        </TabsContent>

        <TabsContent value="timeline" className="space-y-6">
          <ProjectTimeline 
            jobs={jobs} 
            subcontractors={subcontractors}
          />
        </TabsContent>

        <TabsContent value="ai-scoping" className="space-y-6">
          <AIJobScoping />
        </TabsContent>
      </Tabs>
    </div>
  );
}