import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, 
  Calendar, 
  DollarSign, 
  Package, 
  FileText, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
  Lightbulb,
  Shield,
  TrendingUp,
  Wrench
} from "lucide-react";

interface ScopeAnalysis {
  jobId?: number;
  scopeOfWork: {
    phases: Array<{
      name: string;
      description: string;
      estimatedDuration: string;
      prerequisites: string[];
      deliverables: string[];
    }>;
    totalEstimatedDuration: string;
    complexity: "simple" | "moderate" | "complex" | "high-complexity";
  };
  materialsList: {
    categories: Array<{
      category: string;
      items: Array<{
        name: string;
        quantity: string;
        unit: string;
        estimatedCost: number;
        priority: "essential" | "recommended" | "optional";
        notes?: string;
      }>;
    }>;
    totalEstimatedCost: number;
    costBreakdown: {
      materials: number;
      labor: number;
      permits: number;
      contingency: number;
    };
  };
  timeline: {
    phases: Array<{
      name: string;
      startDay: number;
      endDay: number;
      dependencies: string[];
      criticalPath: boolean;
    }>;
    totalDays: number;
    workingDaysPerWeek: number;
    estimatedWeeks: number;
  };
  considerations: {
    permits: string[];
    specialRequirements: string[];
    weatherDependencies: string[];
    safetyConsiderations: string[];
    potentialRisks: string[];
  };
  recommendations: {
    bestPractices: string[];
    costSavingTips: string[];
    qualityAssurance: string[];
  };
}

interface AIScopeAnalyzerProps {
  jobId?: number;
  jobDescription?: string;
  jobType?: string;
  location?: string;
  estimatedCost?: number;
}

const getComplexityColor = (complexity: string) => {
  switch (complexity) {
    case 'simple': return 'bg-green-100 text-green-800 border-green-200';
    case 'moderate': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'complex': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'high-complexity': return 'bg-red-100 text-red-800 border-red-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'essential': return 'bg-red-100 text-red-800 border-red-200';
    case 'recommended': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'optional': return 'bg-gray-100 text-gray-800 border-gray-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export default function AIScopeAnalyzer({ 
  jobId, 
  jobDescription, 
  jobType, 
  location, 
  estimatedCost 
}: AIScopeAnalyzerProps) {
  const { toast } = useToast();
  const [analysis, setAnalysis] = useState<ScopeAnalysis | null>(null);

  const analyzeJobScopeMutation = useMutation({
    mutationFn: async () => {
      if (jobId) {
        const res = await apiRequest("POST", `/api/ai/analyze-job-scope/${jobId}`);
        return res.json() as Promise<ScopeAnalysis>;
      } else {
        const res = await apiRequest("POST", "/api/ai/analyze-scope", {
          jobDescription,
          jobType,
          location,
          budget: estimatedCost
        });
        return res.json() as Promise<ScopeAnalysis>;
      }
    },
    onSuccess: (data: ScopeAnalysis) => {
      setAnalysis(data);
      toast({
        title: "AI Analysis Complete",
        description: "Comprehensive scope of work and materials list generated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = () => {
    if (!jobDescription && !jobId) {
      toast({
        title: "Missing Information",
        description: "Job description is required for analysis",
        variant: "destructive",
      });
      return;
    }
    analyzeJobScopeMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Job Scope Analyzer
          </CardTitle>
          <Button
            onClick={handleAnalyze}
            disabled={analyzeJobScopeMutation.isPending}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <Brain className="h-4 w-4 mr-2" />
            {analyzeJobScopeMutation.isPending ? 'Analyzing...' : 'Analyze Job Scope'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {analysis ? (
          <Tabs defaultValue="scope" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="scope">Scope</TabsTrigger>
              <TabsTrigger value="materials">Materials</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="considerations">Considerations</TabsTrigger>
              <TabsTrigger value="recommendations">Tips</TabsTrigger>
            </TabsList>

            {/* Scope of Work Tab */}
            <TabsContent value="scope" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Scope of Work</h3>
                <div className="flex items-center gap-2">
                  <Badge className={getComplexityColor(analysis.scopeOfWork.complexity)}>
                    {analysis.scopeOfWork.complexity}
                  </Badge>
                  <Badge variant="outline">
                    {analysis.scopeOfWork.totalEstimatedDuration}
                  </Badge>
                </div>
              </div>

              <div className="space-y-4">
                {analysis.scopeOfWork.phases.map((phase, index) => (
                  <Card key={index} className="border-l-4 border-l-blue-600">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{phase.name}</CardTitle>
                        <Badge variant="outline">{phase.estimatedDuration}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        {phase.description}
                      </p>
                      
                      {phase.prerequisites.length > 0 && (
                        <div>
                          <p className="text-sm font-medium mb-1">Prerequisites:</p>
                          <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                            {phase.prerequisites.map((prereq, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <AlertTriangle className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                                {prereq}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {phase.deliverables.length > 0 && (
                        <div>
                          <p className="text-sm font-medium mb-1">Deliverables:</p>
                          <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                            {phase.deliverables.map((deliverable, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                                {deliverable}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Materials Tab */}
            <TabsContent value="materials" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Materials & Cost Breakdown</h3>
                <Badge variant="outline" className="text-lg font-bold">
                  ${analysis.materialsList.totalEstimatedCost.toLocaleString()}
                </Badge>
              </div>

              {/* Cost Breakdown Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cost Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <p className="text-sm text-slate-600">Materials</p>
                      <p className="text-xl font-bold text-blue-600">
                        ${analysis.materialsList.costBreakdown.materials.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-slate-600">Labor</p>
                      <p className="text-xl font-bold text-green-600">
                        ${analysis.materialsList.costBreakdown.labor.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-slate-600">Permits</p>
                      <p className="text-xl font-bold text-orange-600">
                        ${analysis.materialsList.costBreakdown.permits.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-slate-600">Contingency</p>
                      <p className="text-xl font-bold text-purple-600">
                        ${analysis.materialsList.costBreakdown.contingency.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Materials Categories */}
              <div className="space-y-4">
                {analysis.materialsList.categories.map((category, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        {category.category}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {category.items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium">{item.name}</p>
                                <Badge className={`text-xs ${getPriorityColor(item.priority)}`}>
                                  {item.priority}
                                </Badge>
                              </div>
                              <p className="text-sm text-slate-600 dark:text-slate-300">
                                {item.quantity} {item.unit}
                              </p>
                              {item.notes && (
                                <p className="text-xs text-slate-500 mt-1">{item.notes}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="font-bold">${item.estimatedCost.toLocaleString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Timeline Tab */}
            <TabsContent value="timeline" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Project Timeline</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {analysis.timeline.totalDays} days
                  </Badge>
                  <Badge variant="outline">
                    {analysis.timeline.estimatedWeeks} weeks
                  </Badge>
                </div>
              </div>

              <div className="space-y-3">
                {analysis.timeline.phases.map((phase, index) => (
                  <Card key={index} className={`${phase.criticalPath ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-gray-300'}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{phase.name}</h4>
                          {phase.criticalPath && (
                            <Badge variant="destructive" className="text-xs">Critical Path</Badge>
                          )}
                        </div>
                        <div className="text-sm text-slate-600">
                          Day {phase.startDay} - {phase.endDay}
                        </div>
                      </div>
                      
                      <Progress 
                        value={((phase.endDay - phase.startDay + 1) / analysis.timeline.totalDays) * 100}
                        className="h-2 mb-2"
                      />
                      
                      {phase.dependencies.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 mb-1">Dependencies:</p>
                          <p className="text-xs text-slate-600">{phase.dependencies.join(', ')}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Considerations Tab */}
            <TabsContent value="considerations" className="space-y-4">
              <h3 className="text-lg font-semibold">Project Considerations</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.considerations.permits.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Required Permits
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.considerations.permits.map((permit, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                            {permit}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {analysis.considerations.safetyConsiderations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Safety Considerations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.considerations.safetyConsiderations.map((safety, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Shield className="h-3 w-3 text-blue-600 mt-0.5 flex-shrink-0" />
                            {safety}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {analysis.considerations.specialRequirements.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        Special Requirements
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.considerations.specialRequirements.map((req, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Wrench className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {analysis.considerations.potentialRisks.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Potential Risks
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.considerations.potentialRisks.map((risk, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* Recommendations Tab */}
            <TabsContent value="recommendations" className="space-y-4">
              <h3 className="text-lg font-semibold">AI Recommendations</h3>
              
              <div className="space-y-4">
                {analysis.recommendations.bestPractices.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Best Practices
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.recommendations.bestPractices.map((practice, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Target className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                            {practice}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {analysis.recommendations.costSavingTips.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Cost Saving Tips
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.recommendations.costSavingTips.map((tip, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <DollarSign className="h-3 w-3 text-blue-600 mt-0.5 flex-shrink-0" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {analysis.recommendations.qualityAssurance.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        Quality Assurance
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.recommendations.qualityAssurance.map((qa, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-3 w-3 text-purple-500 mt-0.5 flex-shrink-0" />
                            {qa}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="text-center py-8">
            <Brain className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-500 mb-4">
              AI-powered analysis will generate comprehensive scope of work, materials list, timeline, and recommendations
            </p>
            <p className="text-sm text-slate-400">
              {jobDescription ? 'Click "Analyze Job Scope" to begin' : 'Job description required for analysis'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}