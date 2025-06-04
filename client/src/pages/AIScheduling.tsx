import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Brain, Zap, TrendingUp } from "lucide-react";

export default function AIScheduling() {
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

  if (isLoading || !isAuthenticated) {
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">AI Scheduling</h1>
          <p className="text-slate-600 dark:text-slate-400">Optimize your project scheduling with AI-powered insights</p>
        </div>
        <Button>
          <Brain className="w-4 h-4 mr-2" />
          Optimize Schedule
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              Smart Scheduling
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Let AI automatically optimize your project timelines and resource allocation.
            </p>
            <Button variant="outline" className="w-full">
              Start Auto-Scheduling
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-600" />
              Resource Optimization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Optimize subcontractor assignments and equipment usage across projects.
            </p>
            <Button variant="outline" className="w-full">
              Optimize Resources
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Predictive Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Get AI-powered predictions for project completion and potential delays.
            </p>
            <Button variant="outline" className="w-full">
              View Predictions
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Scheduling Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div>
                <h4 className="font-medium text-slate-900 dark:text-slate-100">Schedule Efficiency</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">Current optimization level</p>
              </div>
              <Badge variant="default">85%</Badge>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div>
                <h4 className="font-medium text-slate-900 dark:text-slate-100">Resource Utilization</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">Subcontractor efficiency</p>
              </div>
              <Badge variant="default">92%</Badge>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div>
                <h4 className="font-medium text-slate-900 dark:text-slate-100">Predicted Delays</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">Potential scheduling conflicts</p>
              </div>
              <Badge variant="secondary">2 detected</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}