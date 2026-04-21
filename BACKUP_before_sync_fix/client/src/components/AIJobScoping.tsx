import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  Brain, 
  Calculator, 
  Clock, 
  DollarSign, 
  Package, 
  AlertTriangle,
  CheckCircle,
  Lightbulb,
  TrendingUp,
  Shield,
  Zap
} from "lucide-react";

interface ScopeAnalysis {
  scopeOfWork: {
    phases: Array<{
      name: string;
      description: string;
      estimatedDuration: string;
      prerequisites: string[];
      deliverables: string[];
    }>;
    totalEstimatedDuration: string;
    complexity: string;
  };
  materialsList: {
    categories: Array<{
      category: string;
      items: Array<{
        name: string;
        quantity: string;
        unit: string;
        estimatedCost: number;
        priority: string;
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

export function AIJobScoping() {
  const [jobDescription, setJobDescription] = useState('');
  const [analysis, setAnalysis] = useState<ScopeAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const analyzeJobMutation = useMutation({
    mutationFn: async (description: string) => {
      const response = await apiRequest('POST', '/api/ai/analyze-job-scope', { description });
      return response.json();
    },
    onSuccess: (data: ScopeAnalysis) => {
      setAnalysis(data);
      toast({
        title: "Analysis Complete",
        description: "AI has analyzed your project scope and generated recommendations.",
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
    if (!jobDescription.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide a job description to analyze.",
        variant: "destructive",
      });
      return;
    }
    analyzeJobMutation.mutate(jobDescription);
  };

  const getComplexityColor = (complexity: string) => {
    switch (complexity.toLowerCase()) {
      case 'simple': return 'text-green-600 bg-green-50';
      case 'moderate': return 'text-blue-600 bg-blue-50';
      case 'complex': return 'text-orange-600 bg-orange-50';
      case 'high-complexity': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'essential': return 'destructive';
      case 'recommended': return 'default';
      case 'optional': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            AI-Powered Job Scope Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="jobDescription">Project Description</Label>
            <Textarea
              id="jobDescription"
              placeholder="Describe your project in detail. Include location, scope of work, any special requirements, client preferences, and timeline constraints..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={6}
              className="mt-2"
            />
          </div>
          <Button 
            onClick={handleAnalyze}
            disabled={analyzeJobMutation.isPending || !jobDescription.trim()}
            className="w-full"
          >
            {analyzeJobMutation.isPending ? (
              <>
                <Brain className="mr-2 h-4 w-4 animate-pulse" />
                Analyzing Project Scope...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Generate AI Analysis
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-6">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                Project Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <Clock className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">Duration</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{analysis.scopeOfWork.totalEstimatedDuration}</p>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <DollarSign className="h-8 w-8 text-green-600 mx-auto mb-2" />
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">Est. Cost</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">${analysis.materialsList.totalEstimatedCost.toLocaleString()}</p>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <Badge className={`${getComplexityColor(analysis.scopeOfWork.complexity)} px-3 py-1`}>
                    {analysis.scopeOfWork.complexity.replace('-', ' ').toUpperCase()}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scope of Work */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Scope of Work Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analysis.scopeOfWork.phases.map((phase, index) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">{phase.name}</h4>
                      <Badge variant="outline">{phase.estimatedDuration}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{phase.description}</p>
                    
                    {phase.prerequisites.length > 0 && (
                      <div className="mb-2">
                        <h5 className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Prerequisites:</h5>
                        <div className="flex flex-wrap gap-1">
                          {phase.prerequisites.map((prereq, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{prereq}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <h5 className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Deliverables:</h5>
                      <div className="flex flex-wrap gap-1">
                        {phase.deliverables.map((deliverable, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{deliverable}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Materials & Cost Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-orange-600" />
                Materials & Cost Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Cost Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">Materials</h4>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                    ${analysis.materialsList.costBreakdown.materials.toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                  <h4 className="text-sm font-medium text-green-900 dark:text-green-100">Labor</h4>
                  <p className="text-lg font-bold text-green-700 dark:text-green-300">
                    ${analysis.materialsList.costBreakdown.labor.toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
                  <h4 className="text-sm font-medium text-purple-900 dark:text-purple-100">Permits</h4>
                  <p className="text-lg font-bold text-purple-700 dark:text-purple-300">
                    ${analysis.materialsList.costBreakdown.permits.toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
                  <h4 className="text-sm font-medium text-orange-900 dark:text-orange-100">Contingency</h4>
                  <p className="text-lg font-bold text-orange-700 dark:text-orange-300">
                    ${analysis.materialsList.costBreakdown.contingency.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Materials List */}
              <div className="space-y-4">
                {analysis.materialsList.categories.map((category, index) => (
                  <div key={index}>
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{category.category}</h4>
                    <div className="space-y-2">
                      {category.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
                              <Badge variant={getPriorityColor(item.priority)} className="text-xs">
                                {item.priority}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              {item.quantity} {item.unit}
                            </p>
                            {item.notes && (
                              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{item.notes}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              ${item.estimatedCost.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Timeline & Critical Path */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-indigo-600" />
                Project Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-4 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <h4 className="font-medium text-indigo-900 dark:text-indigo-100">Total Duration</h4>
                    <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{analysis.timeline.totalDays} days</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-indigo-900 dark:text-indigo-100">Estimated Weeks</h4>
                    <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{analysis.timeline.estimatedWeeks} weeks</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-indigo-900 dark:text-indigo-100">Working Days/Week</h4>
                    <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{analysis.timeline.workingDaysPerWeek} days</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {analysis.timeline.phases.map((phase, index) => (
                  <div key={index} className={`p-3 border rounded-lg ${phase.criticalPath ? 'border-red-300 bg-red-50 dark:bg-red-950/30' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{phase.name}</span>
                        {phase.criticalPath && (
                          <Badge variant="destructive" className="text-xs">Critical Path</Badge>
                        )}
                      </div>
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        Day {phase.startDay} - {phase.endDay}
                      </span>
                    </div>
                    {phase.dependencies.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs text-slate-500 dark:text-slate-500">Dependencies: </span>
                        {phase.dependencies.map((dep, i) => (
                          <Badge key={i} variant="outline" className="text-xs mr-1">{dep}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Considerations & Recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  Important Considerations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysis.considerations.permits.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-2">Required Permits</h4>
                    <div className="space-y-1">
                      {analysis.considerations.permits.map((permit, i) => (
                        <p key={i} className="text-sm text-slate-600 dark:text-slate-400">• {permit}</p>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.considerations.safetyConsiderations.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-2">Safety Requirements</h4>
                    <div className="space-y-1">
                      {analysis.considerations.safetyConsiderations.map((safety, i) => (
                        <p key={i} className="text-sm text-slate-600 dark:text-slate-400">• {safety}</p>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.considerations.potentialRisks.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-2">Potential Risks</h4>
                    <div className="space-y-1">
                      {analysis.considerations.potentialRisks.map((risk, i) => (
                        <p key={i} className="text-sm text-red-600 dark:text-red-400">• {risk}</p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  AI Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysis.recommendations.bestPractices.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-2">Best Practices</h4>
                    <div className="space-y-1">
                      {analysis.recommendations.bestPractices.map((practice, i) => (
                        <p key={i} className="text-sm text-green-600 dark:text-green-400">• {practice}</p>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.recommendations.costSavingTips.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-2">Cost Optimization</h4>
                    <div className="space-y-1">
                      {analysis.recommendations.costSavingTips.map((tip, i) => (
                        <p key={i} className="text-sm text-blue-600 dark:text-blue-400">• {tip}</p>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.recommendations.qualityAssurance.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100 mb-2">Quality Assurance</h4>
                    <div className="space-y-1">
                      {analysis.recommendations.qualityAssurance.map((qa, i) => (
                        <p key={i} className="text-sm text-purple-600 dark:text-purple-400">• {qa}</p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}