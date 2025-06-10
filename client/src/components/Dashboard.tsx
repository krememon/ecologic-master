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
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Brain,
  Target,
  Zap
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdvancedAnalytics } from "./AdvancedAnalytics";
import { ProjectTimeline } from "./ProjectTimeline";
import { AIJobScoping } from "./AIJobScoping";

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
          } else if (daysOverdue > -3) {
            // Due within 3 days
            alerts.push({
              id: `invoice-due-${invoice.id}`,
              type: 'warning',
              title: 'Payment Due Soon',
              message: `Invoice ${invoice.invoiceNumber} due ${daysOverdue === 0 ? 'today' : `in ${Math.abs(daysOverdue)} day${Math.abs(daysOverdue) > 1 ? 's' : ''}`} ($${parseFloat(invoice.amount).toLocaleString()})`,
              timestamp: dueDate,
              icon: Clock,
              bgColor: 'bg-orange-50 dark:bg-orange-900/20',
              borderColor: 'border-orange-200 dark:border-orange-800',
              iconColor: 'text-orange-600 dark:text-orange-400'
            });
          }
        }
      });
    }

    // Check for job deadlines approaching
    if (jobs) {
      jobs.forEach((job: any) => {
        if (job.endDate && job.status !== 'completed') {
          const endDate = new Date(job.endDate);
          const daysUntilDeadline = Math.floor((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilDeadline < 0) {
            // Overdue job
            alerts.push({
              id: `job-overdue-${job.id}`,
              type: 'error',
              title: 'Job Overdue',
              message: `"${job.title}" deadline passed ${Math.abs(daysUntilDeadline)} day${Math.abs(daysUntilDeadline) > 1 ? 's' : ''} ago`,
              timestamp: endDate,
              icon: AlertTriangle,
              bgColor: 'bg-red-50 dark:bg-red-900/20',
              borderColor: 'border-red-200 dark:border-red-800',
              iconColor: 'text-red-600 dark:text-red-400'
            });
          } else if (daysUntilDeadline <= 3) {
            // Deadline within 3 days
            alerts.push({
              id: `job-deadline-${job.id}`,
              type: 'warning',
              title: 'Deadline Approaching',
              message: `"${job.title}" due ${daysUntilDeadline === 0 ? 'today' : `in ${daysUntilDeadline} day${daysUntilDeadline > 1 ? 's' : ''}`}`,
              timestamp: endDate,
              icon: Clock,
              bgColor: 'bg-orange-50 dark:bg-orange-900/20',
              borderColor: 'border-orange-200 dark:border-orange-800',
              iconColor: 'text-orange-600 dark:text-orange-400'
            });
          }
        }
      });
    }

    // Check for recently completed jobs
    if (jobs) {
      const recentlyCompleted = jobs.filter((job: any) => {
        if (job.status === 'completed' && job.updatedAt) {
          const completedDate = new Date(job.updatedAt);
          const daysSinceCompleted = Math.floor((today.getTime() - completedDate.getTime()) / (1000 * 60 * 60 * 24));
          return daysSinceCompleted <= 1; // Within last day
        }
        return false;
      });

      recentlyCompleted.forEach((job: any) => {
        alerts.push({
          id: `job-completed-${job.id}`,
          type: 'success',
          title: 'Job Completed',
          message: `"${job.title}" marked as complete`,
          timestamp: new Date(job.updatedAt),
          icon: CheckCircle,
          bgColor: 'bg-green-50 dark:bg-green-900/20',
          borderColor: 'border-green-200 dark:border-green-800',
          iconColor: 'text-green-600 dark:text-green-400'
        });
      });
    }

    // Sort alerts by priority and timestamp
    const priorityOrder = { error: 1, warning: 2, info: 3, success: 4 };
    return alerts
      .sort((a, b) => {
        if (priorityOrder[a.type] !== priorityOrder[b.type]) {
          return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return b.timestamp.getTime() - a.timestamp.getTime();
      })
      .slice(0, 5); // Show only top 5 alerts
  };

  const alerts = generateAlerts();

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInHours / 24);
    
    if (diffInDays > 0) {
      return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    } else if (diffInHours > 0) {
      return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recent Alerts</h3>
          {alerts.length > 0 && (
            <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
              {alerts.filter(a => a.type === 'error' || a.type === 'warning').length}
            </Badge>
          )}
        </div>
      </div>
      <CardContent className="p-6">
        {alerts.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400 font-medium">All caught up!</p>
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

// Form Components
function CreateJobForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    budget: '',
    priority: 'medium',
    status: 'planning'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      budget: parseFloat(formData.budget) || 0
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Job Title</Label>
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Enter job title"
          required
        />
      </div>
      
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Job description"
          rows={3}
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="budget">Budget</Label>
        <Input
          id="budget"
          type="number"
          value={formData.budget}
          onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
          placeholder="0.00"
        />
      </div>
      
      <div>
        <Label htmlFor="priority">Priority</Label>
        <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Creating..." : "Create Job"}
      </Button>
    </form>
  );
}

function CreateSubcontractorForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    skills: '',
    hourlyRate: '',
    availability: 'available'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      hourlyRate: parseFloat(formData.hourlyRate) || 0,
      skills: formData.skills.split(',').map(skill => skill.trim()).filter(Boolean)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Full Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter full name"
          required
        />
      </div>
      
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="email@example.com"
          required
        />
      </div>
      
      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="Phone number"
        />
      </div>
      
      <div>
        <Label htmlFor="company">Company</Label>
        <Input
          id="company"
          value={formData.company}
          onChange={(e) => setFormData({ ...formData, company: e.target.value })}
          placeholder="Company name"
        />
      </div>
      
      <div>
        <Label htmlFor="skills">Skills (comma separated)</Label>
        <Input
          id="skills"
          value={formData.skills}
          onChange={(e) => setFormData({ ...formData, skills: e.target.value })}
          placeholder="plumbing, electrical, carpentry"
        />
      </div>
      
      <div>
        <Label htmlFor="hourlyRate">Hourly Rate</Label>
        <Input
          id="hourlyRate"
          type="number"
          value={formData.hourlyRate}
          onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
          placeholder="0.00"
        />
      </div>
      
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Adding..." : "Add Subcontractor"}
      </Button>
    </form>
  );
}

function CreateInvoiceForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    clientName: '',
    jobTitle: '',
    amount: '',
    dueDate: '',
    description: '',
    status: 'draft'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      amount: parseFloat(formData.amount) || 0,
      issueDate: new Date().toISOString().split('T')[0]
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="clientName">Client Name</Label>
        <Input
          id="clientName"
          value={formData.clientName}
          onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
          placeholder="Client name"
          required
        />
      </div>
      
      <div>
        <Label htmlFor="jobTitle">Job Title</Label>
        <Input
          id="jobTitle"
          value={formData.jobTitle}
          onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
          placeholder="Job description"
          required
        />
      </div>
      
      <div>
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          placeholder="0.00"
          required
        />
      </div>
      
      <div>
        <Label htmlFor="dueDate">Due Date</Label>
        <Input
          id="dueDate"
          type="date"
          value={formData.dueDate}
          onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
          required
        />
      </div>
      
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Invoice description"
          rows={3}
        />
      </div>
      
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Generating..." : "Generate Invoice"}
      </Button>
    </form>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [isJobDialogOpen, setIsJobDialogOpen] = useState(false);
  const [isSubcontractorDialogOpen, setIsSubcontractorDialogOpen] = useState(false);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<any>(null);

  // Helper function for clean weekly schedule
  const getWeekDays = () => {
    const today = new Date();
    const currentWeek = new Date(today);
    const startOfWeek = new Date(currentWeek.setDate(currentWeek.getDate() - currentWeek.getDay() + 1)); // Monday
    
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const shortNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      
      days.push({
        fullName: dayNames[i],
        shortName: shortNames[i],
        date: date.getDate(),
        month: monthNames[date.getMonth()],
        fullDate: date,
        isToday: date.toDateString() === new Date().toDateString(),
        dateString: date.toISOString().split('T')[0]
      });
    }
    
    return days;
  };

  const getJobType = (description: string) => {
    const desc = description.toLowerCase();
    if (desc.includes('renovation') || desc.includes('construction') || desc.includes('build')) return 'construction';
    if (desc.includes('install') || desc.includes('setup')) return 'installation';
    if (desc.includes('inspect') || desc.includes('check')) return 'inspection';
    if (desc.includes('repair') || desc.includes('fix') || desc.includes('maintenance')) return 'repair';
    if (desc.includes('plumb')) return 'plumbing';
    if (desc.includes('electric')) return 'electrical';
    return 'general';
  };

  const getWeekStats = () => {
    const activeJobs = jobs?.filter((job: any) => job.status === 'in_progress' || job.status === 'active').length || 0;
    const urgentJobs = jobs?.filter((job: any) => job.priority === 'high').length || 0;
    const totalJobs = jobs?.length || 0;
    
    return {
      totalJobs,
      activeJobs,
      urgentJobs,
      utilization: totalJobs > 0 ? Math.round((activeJobs / totalJobs) * 100) : 0
    };
  };

  const handleScheduleClick = (day: any) => {
    setSelectedDay(day);
    setIsScheduleDialogOpen(true);
  };

  const getJobColor = (type: string) => {
    switch (type) {
      case 'construction':
        return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
      case 'installation':
        return 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800';
      case 'inspection':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200 border-orange-200 dark:border-orange-800';
      case 'repair':
        return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700';
    }
  };
  
  const { data: stats = {}, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<any[]>({
    queryKey: ["/api/subcontractors"],
  });

  // Mutations for creating new items
  const createJobMutation = useMutation({
    mutationFn: async (jobData: any) => {
      const res = await apiRequest("POST", "/api/jobs", jobData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setIsJobDialogOpen(false);
      toast({
        title: "Job Created",
        description: "New job has been created successfully.",
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

  const createSubcontractorMutation = useMutation({
    mutationFn: async (subcontractorData: any) => {
      const res = await apiRequest("POST", "/api/subcontractors", subcontractorData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      setIsSubcontractorDialogOpen(false);
      toast({
        title: "Subcontractor Added",
        description: "New subcontractor has been added successfully.",
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

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoiceData: any) => {
      const res = await apiRequest("POST", "/api/invoices", invoiceData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setIsInvoiceDialogOpen(false);
      toast({
        title: "Invoice Generated",
        description: "New invoice has been generated successfully.",
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

  if (statsLoading || jobsLoading || invoicesLoading) {
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

  const handleCreateJob = (jobData: any) => {
    createJobMutation.mutate(jobData);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Business Dashboard</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Comprehensive project management and analytics</p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={isJobDialogOpen} onOpenChange={setIsJobDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                New Job
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Job</DialogTitle>
              </DialogHeader>
              <CreateJobForm onSubmit={handleCreateJob} isLoading={createJobMutation.isPending} />
            </DialogContent>
          </Dialog>
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
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Subcontractors</p>
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
          <Card className="border-slate-200 dark:border-slate-800 rounded-2xl">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quick Actions</h3>
            </div>
            <CardContent className="p-6 space-y-3">
              <Dialog open={isJobDialogOpen} onOpenChange={setIsJobDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    className="w-full h-10 transition-all duration-200 ease-in-out transform hover:scale-105 hover:shadow-md rounded-2xl text-sm" 
                    variant="default"
                  >
                    <Plus className="w-4 h-4 mr-2 transition-transform duration-200" />
                    Create New Job
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[350px] rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Create New Job</DialogTitle>
                  </DialogHeader>
                  <CreateJobForm onSubmit={createJobMutation.mutate} isLoading={createJobMutation.isPending} />
                </DialogContent>
              </Dialog>
              
              <Dialog open={isSubcontractorDialogOpen} onOpenChange={setIsSubcontractorDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    className="w-full h-10 transition-all duration-200 ease-in-out transform hover:scale-105 hover:shadow-md rounded-2xl text-sm" 
                    variant="outline"
                  >
                    <UserPlus className="w-4 h-4 mr-2 transition-transform duration-200" />
                    Add Subcontractor
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[350px] rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Add New Subcontractor</DialogTitle>
                  </DialogHeader>
                  <CreateSubcontractorForm onSubmit={createSubcontractorMutation.mutate} isLoading={createSubcontractorMutation.isPending} />
                </DialogContent>
              </Dialog>

              <Dialog open={isInvoiceDialogOpen} onOpenChange={setIsInvoiceDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    className="w-full h-10 transition-all duration-200 ease-in-out transform hover:scale-105 hover:shadow-md rounded-2xl text-sm" 
                    variant="outline"
                  >
                    <FileText className="w-4 h-4 mr-2 transition-transform duration-200" />
                    Generate Invoice
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[350px] rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Generate New Invoice</DialogTitle>
                  </DialogHeader>
                  <CreateInvoiceForm onSubmit={createInvoiceMutation.mutate} isLoading={createInvoiceMutation.isPending} />
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Alerts & Notifications */}
          <RecentAlertsCard jobs={jobs} invoices={invoices} />
        </div>
      </div>

      {/* Enhanced Schedule Overview */}
      <Card className="border-slate-200 dark:border-slate-800 rounded-2xl">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              This Week's Schedule
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {getWeekDays()[0]?.month} {getWeekDays()[0]?.date}-{getWeekDays()[6]?.date}, {new Date().getFullYear()}
            </p>
          </div>
        </div>
        <CardContent className="p-6">
          <div className="grid grid-cols-7 gap-4">
            {getWeekDays().map((day, index) => (
              <div 
                key={day.dateString} 
                className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 min-h-[140px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer group flex flex-col items-center justify-center"
                onClick={() => handleScheduleClick(day)}
              >
                <div className="text-center mb-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{day.shortName}</p>
                  <p className={`text-xs rounded-full px-2 py-1 inline-block ${
                    day.isToday 
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-medium' 
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                    {day.month} {day.date}
                  </p>
                </div>
                
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900 transition-colors">
                  <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Schedule Dialog */}
      <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Schedule for {selectedDay?.fullName}, {selectedDay?.month} {selectedDay?.date}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
                Schedule Your Day
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                Add jobs, appointments, or tasks for this day
              </p>
              <div className="space-y-3">
                <Button 
                  onClick={() => {
                    setIsScheduleDialogOpen(false);
                    setIsJobDialogOpen(true);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Schedule New Job
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => {
                    // Navigate to AI scheduling page
                    window.location.href = '/ai-scheduling';
                  }}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Open AI Scheduler
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <RecentAlertsCard jobs={jobs} invoices={invoices} />
          </div>
          </div>
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
