import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar, Clock, Users, AlertTriangle, TrendingUp, Star, DollarSign } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AISchedulerProps {
  jobId?: number;
  companyId: number;
}

interface ScheduleOptimization {
  jobId: number;
  recommendedSubcontractors: Array<{
    subcontractorId: number;
    name: string;
    matchScore: number;
    reasoning: string;
    estimatedDuration: string;
    conflictWarnings: string[];
  }>;
  optimalStartDate: string;
  estimatedCompletionDate: string;
  resourceRequirements: {
    skillsNeeded: string[];
    estimatedHours: number;
    budgetRecommendation: number;
  };
  riskAssessment: {
    level: "low" | "medium" | "high";
    factors: string[];
    mitigation: string[];
  };
}

interface ResourceAllocation {
  companyId: number;
  weeklySchedule: Array<{
    subcontractorId: number;
    name: string;
    workload: number;
    assignments: Array<{
      jobId: number;
      jobTitle: string;
      startDate: string;
      endDate: string;
      hoursAllocated: number;
    }>;
    availability: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
  }>;
  recommendations: string[];
  efficiency: {
    overall: number;
    bottlenecks: string[];
    improvements: string[];
  };
}

interface TimelinePrediction {
  estimatedDuration: number;
  confidence: number;
  milestones: Array<{
    name: string;
    date: string;
    description: string;
  }>;
  riskFactors: string[];
  recommendations: string[];
}

export default function AIScheduler({ jobId, companyId }: AISchedulerProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("optimization");

  const optimizeJobMutation = useMutation({
    mutationFn: async (id: number): Promise<ScheduleOptimization> => {
      return await apiRequest(`/api/ai/optimize-job-schedule/${id}`, "POST");
    },
    onSuccess: () => {
      toast({
        title: "Schedule Optimized",
        description: "AI has generated optimal scheduling recommendations for this job.",
      });
    },
    onError: (error) => {
      toast({
        title: "Optimization Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const timelineMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/ai/predict-timeline/${id}`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Timeline Predicted",
        description: "AI has analyzed the project and predicted completion timeline.",
      });
    },
    onError: (error) => {
      toast({
        title: "Prediction Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: resourceAllocation, isLoading: resourceLoading } = useQuery({
    queryKey: ["/api/ai/resource-allocation"],
    enabled: activeTab === "resources",
  });

  const getRiskColor = (level: string) => {
    switch (level) {
      case "low": return "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900";
      case "medium": return "text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900";
      case "high": return "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900";
      default: return "text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-900";
    }
  };

  const getWorkloadColor = (workload: number) => {
    if (workload >= 90) return "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900";
    if (workload >= 70) return "text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900";
    return "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">AI Schedule Optimizer</h2>
          <p className="text-gray-600 dark:text-gray-400">Intelligent scheduling and resource allocation powered by AI</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="optimization">Job Optimization</TabsTrigger>
          <TabsTrigger value="resources">Resource Allocation</TabsTrigger>
          <TabsTrigger value="timeline">Timeline Prediction</TabsTrigger>
        </TabsList>

        <TabsContent value="optimization" className="space-y-4">
          {jobId ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Schedule Optimization
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4">
                    <Button
                      onClick={() => optimizeJobMutation.mutate(jobId)}
                      disabled={optimizeJobMutation.isPending}
                      className="flex items-center gap-2"
                    >
                      <Clock className="h-4 w-4" />
                      {optimizeJobMutation.isPending ? "Optimizing..." : "Optimize Schedule"}
                    </Button>
                  </div>

                  {optimizeJobMutation.data && (
                    <div className="mt-6 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-lg">Recommended Timeline</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Start Date:</span>
                                <span className="font-medium">{new Date(optimizeJobMutation.data.optimalStartDate).toLocaleDateString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Completion:</span>
                                <span className="font-medium">{new Date(optimizeJobMutation.data.estimatedCompletionDate).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4" />
                              Risk Assessment
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <Badge className={getRiskColor(optimizeJobMutation.data.riskAssessment.level)}>
                              {optimizeJobMutation.data.riskAssessment.level.toUpperCase()} RISK
                            </Badge>
                            <div className="mt-2 space-y-1">
                              {optimizeJobMutation.data.riskAssessment.factors.slice(0, 2).map((factor, index) => (
                                <p key={index} className="text-sm text-gray-600 dark:text-gray-400">• {factor}</p>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Recommended Subcontractors
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {optimizeJobMutation.data.recommendedSubcontractors.map((sub, index) => (
                              <div key={index} className="flex items-center justify-between p-3 border rounded-lg dark:border-gray-700">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-medium">{sub.name}</h4>
                                    <Badge variant="outline" className="flex items-center gap-1">
                                      <Star className="h-3 w-3" />
                                      {sub.matchScore}% match
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{sub.reasoning}</p>
                                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Duration: {sub.estimatedDuration}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5" />
                            Resource Requirements
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">Skills Needed</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {optimizeJobMutation.data.resourceRequirements.skillsNeeded.map((skill, index) => (
                                  <Badge key={index} variant="secondary">{skill}</Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">Estimated Hours</p>
                              <p className="text-lg font-bold">{optimizeJobMutation.data.resourceRequirements.estimatedHours}h</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">Budget Recommendation</p>
                              <p className="text-lg font-bold">${optimizeJobMutation.data.resourceRequirements.budgetRecommendation.toLocaleString()}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Select a specific job to view AI-powered scheduling optimization recommendations.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Resource Allocation Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {resourceLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Analyzing resource allocation...</p>
                  </div>
                </div>
              ) : resourceAllocation ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Overall Efficiency</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-2">
                          <Progress value={resourceAllocation.efficiency.overall} className="flex-1" />
                          <span className="text-lg font-bold">{resourceAllocation.efficiency.overall}%</span>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Active Workers</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{resourceAllocation.weeklySchedule.length}</p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Bottlenecks</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {resourceAllocation.efficiency.bottlenecks.length}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Team Workload Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {resourceAllocation.weeklySchedule.map((worker, index) => (
                          <div key={index} className="p-3 border rounded-lg dark:border-gray-700">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-medium">{worker.name}</h4>
                              <Badge className={getWorkloadColor(worker.workload)}>
                                {worker.workload}% capacity
                              </Badge>
                            </div>
                            <Progress value={worker.workload} className="mb-2" />
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              {worker.assignments.length} active assignments
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>AI Recommendations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {resourceAllocation.recommendations.map((rec, index) => (
                          <div key={index} className="flex items-start gap-2">
                            <TrendingUp className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400" />
                            <p className="text-sm">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ai/resource-allocation"] })}
                    className="flex items-center gap-2"
                  >
                    <TrendingUp className="h-4 w-4" />
                    Generate Resource Analysis
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          {jobId ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Timeline Prediction
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-6">
                  <Button
                    onClick={() => timelineMutation.mutate(jobId)}
                    disabled={timelineMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <Clock className="h-4 w-4" />
                    {timelineMutation.isPending ? "Analyzing..." : "Predict Timeline"}
                  </Button>
                </div>

                {timelineMutation.data && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg">Project Duration</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-center">
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                              {timelineMutation.data.estimatedDuration} days
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              {timelineMutation.data.confidence}% confidence
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg">Risk Factors</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-1">
                            {timelineMutation.data.riskFactors.slice(0, 3).map((risk, index) => (
                              <p key={index} className="text-sm text-gray-600 dark:text-gray-400">• {risk}</p>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle>Project Milestones</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {timelineMutation.data.milestones.map((milestone, index) => (
                            <div key={index} className="flex items-start gap-3 p-3 border rounded-lg dark:border-gray-700">
                              <Calendar className="h-5 w-5 mt-0.5 text-blue-600 dark:text-blue-400" />
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-medium">{milestone.name}</h4>
                                  <span className="text-sm text-gray-600 dark:text-gray-400">
                                    {new Date(milestone.date).toLocaleDateString()}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{milestone.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Optimization Recommendations</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {timelineMutation.data.recommendations.map((rec, index) => (
                            <div key={index} className="flex items-start gap-2">
                              <TrendingUp className="h-4 w-4 mt-0.5 text-green-600 dark:text-green-400" />
                              <p className="text-sm">{rec}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Select a specific job to view AI-powered timeline predictions.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}