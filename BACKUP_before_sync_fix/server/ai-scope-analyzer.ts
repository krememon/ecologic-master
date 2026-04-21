import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ScopeAnalysis {
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

export class AIScopeAnalyzer {
  async analyzeJobScope(
    jobDescription: string,
    jobType?: string,
    location?: string,
    budget?: number
  ): Promise<ScopeAnalysis> {
    try {
      const prompt = this.buildAnalysisPrompt(jobDescription, jobType, location, budget);

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert construction project manager and estimator with 20+ years of experience in residential and commercial construction. You specialize in breaking down job descriptions into comprehensive scope of work, accurate material lists, and realistic timelines.

Your analysis should be:
- Detailed and construction-industry specific
- Realistic in pricing and timeframes
- Compliant with standard building practices
- Focused on practical implementation

Always provide realistic cost estimates based on current market rates and include appropriate contingencies for unforeseen issues.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const analysis = JSON.parse(response.choices[0].message.content || "{}");
      
      // Validate and structure the response
      return this.validateAndStructureAnalysis(analysis);
    } catch (error) {
      console.error("Error analyzing job scope:", error);
      throw new Error("Failed to analyze job scope: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  private buildAnalysisPrompt(
    jobDescription: string,
    jobType?: string,
    location?: string,
    budget?: number
  ): string {
    return `Analyze the following construction job and provide a comprehensive breakdown in JSON format:

Job Description: "${jobDescription}"
${jobType ? `Job Type: ${jobType}` : ''}
${location ? `Location: ${location}` : ''}
${budget ? `Budget: $${budget}` : ''}

Please provide a detailed analysis in the following JSON structure:

{
  "scopeOfWork": {
    "phases": [
      {
        "name": "Phase name",
        "description": "Detailed description of work",
        "estimatedDuration": "X days/weeks",
        "prerequisites": ["List of requirements before starting"],
        "deliverables": ["What will be completed"]
      }
    ],
    "totalEstimatedDuration": "X weeks",
    "complexity": "simple|moderate|complex|high-complexity"
  },
  "materialsList": {
    "categories": [
      {
        "category": "Category name (e.g., Lumber, Electrical, Plumbing)",
        "items": [
          {
            "name": "Material name",
            "quantity": "Amount needed",
            "unit": "Unit of measurement",
            "estimatedCost": 0.00,
            "priority": "essential|recommended|optional",
            "notes": "Additional details if needed"
          }
        ]
      }
    ],
    "totalEstimatedCost": 0.00,
    "costBreakdown": {
      "materials": 0.00,
      "labor": 0.00,
      "permits": 0.00,
      "contingency": 0.00
    }
  },
  "timeline": {
    "phases": [
      {
        "name": "Phase name",
        "startDay": 1,
        "endDay": 5,
        "dependencies": ["Previous phases that must be complete"],
        "criticalPath": true/false
      }
    ],
    "totalDays": 0,
    "workingDaysPerWeek": 5,
    "estimatedWeeks": 0
  },
  "considerations": {
    "permits": ["Required permits"],
    "specialRequirements": ["Special tools, skills, or conditions"],
    "weatherDependencies": ["Weather-sensitive work"],
    "safetyConsiderations": ["Safety requirements and precautions"],
    "potentialRisks": ["Possible complications or delays"]
  },
  "recommendations": {
    "bestPractices": ["Industry best practices for this job"],
    "costSavingTips": ["Ways to reduce costs without compromising quality"],
    "qualityAssurance": ["Steps to ensure quality work"]
  }
}

Ensure all cost estimates are realistic and based on current market rates. Include appropriate markup for contractor profit and overhead. Consider regional variations if location is provided.`;
  }

  private validateAndStructureAnalysis(analysis: any): ScopeAnalysis {
    // Provide defaults and validate structure
    return {
      scopeOfWork: {
        phases: analysis.scopeOfWork?.phases || [],
        totalEstimatedDuration: analysis.scopeOfWork?.totalEstimatedDuration || "Unknown",
        complexity: analysis.scopeOfWork?.complexity || "moderate"
      },
      materialsList: {
        categories: analysis.materialsList?.categories || [],
        totalEstimatedCost: analysis.materialsList?.totalEstimatedCost || 0,
        costBreakdown: analysis.materialsList?.costBreakdown || {
          materials: 0,
          labor: 0,
          permits: 0,
          contingency: 0
        }
      },
      timeline: {
        phases: analysis.timeline?.phases || [],
        totalDays: analysis.timeline?.totalDays || 0,
        workingDaysPerWeek: analysis.timeline?.workingDaysPerWeek || 5,
        estimatedWeeks: analysis.timeline?.estimatedWeeks || 0
      },
      considerations: {
        permits: analysis.considerations?.permits || [],
        specialRequirements: analysis.considerations?.specialRequirements || [],
        weatherDependencies: analysis.considerations?.weatherDependencies || [],
        safetyConsiderations: analysis.considerations?.safetyConsiderations || [],
        potentialRisks: analysis.considerations?.potentialRisks || []
      },
      recommendations: {
        bestPractices: analysis.recommendations?.bestPractices || [],
        costSavingTips: analysis.recommendations?.costSavingTips || [],
        qualityAssurance: analysis.recommendations?.qualityAssurance || []
      }
    };
  }

  async generateQuickEstimate(jobDescription: string): Promise<{
    estimatedCost: number;
    estimatedDuration: string;
    complexity: string;
    keyMaterials: string[];
  }> {
    try {
      const prompt = `Provide a quick estimate for this construction job in JSON format:

Job Description: "${jobDescription}"

Respond with:
{
  "estimatedCost": 0.00,
  "estimatedDuration": "X weeks",
  "complexity": "simple|moderate|complex|high-complexity",
  "keyMaterials": ["Top 5 most important materials needed"]
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a construction estimator. Provide realistic quick estimates based on industry standards."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const estimate = JSON.parse(response.choices[0].message.content || "{}");
      
      return {
        estimatedCost: estimate.estimatedCost || 0,
        estimatedDuration: estimate.estimatedDuration || "Unknown",
        complexity: estimate.complexity || "moderate",
        keyMaterials: estimate.keyMaterials || []
      };
    } catch (error) {
      console.error("Error generating quick estimate:", error);
      throw new Error("Failed to generate estimate: " + (error instanceof Error ? error.message : String(error)));
    }
  }
}

export const aiScopeAnalyzer = new AIScopeAnalyzer();