import OpenAI from "openai";
import { storage } from "./storage";
import type { Job, Subcontractor } from "@shared/schema";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ScheduleOptimization {
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

export interface ResourceAllocation {
  companyId: number;
  weeklySchedule: Array<{
    subcontractorId: number;
    name: string;
    workload: number; // percentage
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

export class AIScheduler {
  async optimizeJobScheduling(jobId: number): Promise<ScheduleOptimization> {
    try {
      // Get job details
      const job = await storage.getJob(jobId);
      if (!job) {
        throw new Error("Job not found");
      }

      // Get all subcontractors for the company
      const subcontractors = await storage.getSubcontractors(job.companyId);
      
      // Get all jobs for context
      const allJobs = await storage.getJobs(job.companyId);

      const prompt = `
You are an AI construction project scheduler and resource allocation expert. Analyze the following job and provide optimal scheduling recommendations.

JOB DETAILS:
- Title: ${job.title}
- Description: ${job.description || "No description"}
- Priority: ${job.priority}
- Status: ${job.status}
- Location: ${job.location || "Not specified"}
- Start Date: ${job.startDate || "Not set"}
- End Date: ${job.endDate || "Not set"}
- Estimated Cost: $${job.estimatedCost || "Not set"}
- Client: ${job.client.name}

AVAILABLE SUBCONTRACTORS:
${subcontractors.map(sub => `
- ID: ${sub.id}
- Name: ${sub.name}
- Skills: ${sub.skills?.join(", ") || "None listed"}
- Rating: ${sub.rating || "No rating"}
- Hourly Rate: $${sub.hourlyRate || "Not set"}
- Available: ${sub.isAvailable ? "Yes" : "No"}
- Notes: ${sub.notes || "None"}
`).join("\n")}

CURRENT COMPANY JOBS:
${allJobs.slice(0, 10).map(j => `
- ${j.title} (${j.status}) - ${j.startDate || "No start"} to ${j.endDate || "No end"}
`).join("\n")}

Provide a comprehensive scheduling optimization in the following JSON format:
{
  "jobId": ${jobId},
  "recommendedSubcontractors": [
    {
      "subcontractorId": number,
      "name": "string",
      "matchScore": number (0-100),
      "reasoning": "detailed explanation of why this person is recommended",
      "estimatedDuration": "X days/weeks",
      "conflictWarnings": ["list of potential scheduling conflicts"]
    }
  ],
  "optimalStartDate": "YYYY-MM-DD",
  "estimatedCompletionDate": "YYYY-MM-DD",
  "resourceRequirements": {
    "skillsNeeded": ["list of required skills"],
    "estimatedHours": number,
    "budgetRecommendation": number
  },
  "riskAssessment": {
    "level": "low|medium|high",
    "factors": ["list of risk factors"],
    "mitigation": ["list of mitigation strategies"]
  }
}

Consider factors like:
- Skill matching between job requirements and subcontractor expertise
- Current workload and availability
- Geographic proximity to job location
- Cost efficiency and budget constraints
- Previous performance and ratings
- Potential scheduling conflicts with other jobs
- Seasonal factors and weather considerations
- Resource dependencies and sequencing
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const optimization = JSON.parse(response.choices[0].message.content || "{}");
      return optimization as ScheduleOptimization;

    } catch (error) {
      console.error("Error in AI scheduling optimization:", error);
      throw new Error("Failed to generate scheduling optimization");
    }
  }

  async generateResourceAllocation(companyId: number): Promise<ResourceAllocation> {
    try {
      // Get company data
      const subcontractors = await storage.getSubcontractors(companyId);
      const jobs = await storage.getJobs(companyId);
      
      // Filter active jobs
      const activeJobs = jobs.filter(job => 
        job.status === "in_progress" || job.status === "planning"
      );

      const prompt = `
You are an AI resource allocation specialist for construction projects. Analyze the current workforce and active projects to provide optimal resource allocation recommendations.

AVAILABLE SUBCONTRACTORS:
${subcontractors.map(sub => `
- ID: ${sub.id}
- Name: ${sub.name}
- Skills: ${sub.skills?.join(", ") || "None listed"}
- Rating: ${sub.rating || "No rating"}
- Hourly Rate: $${sub.hourlyRate || "Not set"}
- Available: ${sub.isAvailable ? "Yes" : "No"}
- Notes: ${sub.notes || "None"}
`).join("\n")}

ACTIVE JOBS:
${activeJobs.map(job => `
- ID: ${job.id}
- Title: ${job.title}
- Status: ${job.status}
- Priority: ${job.priority}
- Start: ${job.startDate || "Not set"}
- End: ${job.endDate || "Not set"}
- Location: ${job.location || "Not specified"}
- Client: ${job.client.name}
`).join("\n")}

Provide a comprehensive resource allocation plan in the following JSON format:
{
  "companyId": ${companyId},
  "weeklySchedule": [
    {
      "subcontractorId": number,
      "name": "string",
      "workload": number (0-100 percentage),
      "assignments": [
        {
          "jobId": number,
          "jobTitle": "string",
          "startDate": "YYYY-MM-DD",
          "endDate": "YYYY-MM-DD",
          "hoursAllocated": number
        }
      ],
      "availability": {
        "monday": boolean,
        "tuesday": boolean,
        "wednesday": boolean,
        "thursday": boolean,
        "friday": boolean,
        "saturday": boolean,
        "sunday": boolean
      }
    }
  ],
  "recommendations": [
    "actionable recommendations for improving resource allocation"
  ],
  "efficiency": {
    "overall": number (0-100 percentage),
    "bottlenecks": ["identified bottlenecks"],
    "improvements": ["suggested improvements"]
  }
}

Consider factors like:
- Skill matching and expertise requirements
- Workload balancing across team members
- Geographic efficiency and travel time
- Cost optimization and budget constraints
- Deadline priorities and critical path
- Subcontractor availability and preferences
- Equipment and material dependencies
- Quality standards and previous performance
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const allocation = JSON.parse(response.choices[0].message.content || "{}");
      return allocation as ResourceAllocation;

    } catch (error) {
      console.error("Error in AI resource allocation:", error);
      throw new Error("Failed to generate resource allocation");
    }
  }

  async predictProjectTimeline(jobId: number): Promise<{
    estimatedDuration: number; // in days
    confidence: number; // 0-100
    milestones: Array<{
      name: string;
      date: string;
      description: string;
    }>;
    riskFactors: string[];
    recommendations: string[];
  }> {
    try {
      const job = await storage.getJob(jobId);
      if (!job) {
        throw new Error("Job not found");
      }

      const subcontractors = await storage.getSubcontractors(job.companyId);
      const historicalJobs = await storage.getJobs(job.companyId);

      // Filter completed jobs for historical analysis
      const completedJobs = historicalJobs.filter(j => j.status === "completed");

      const prompt = `
You are an AI project timeline prediction specialist. Analyze the job details and historical data to predict accurate project timelines.

CURRENT JOB:
- Title: ${job.title}
- Description: ${job.description || "No description"}
- Priority: ${job.priority}
- Location: ${job.location || "Not specified"}
- Estimated Cost: $${job.estimatedCost || "Not set"}
- Client: ${job.client.name}

HISTORICAL COMPLETED JOBS (for pattern analysis):
${completedJobs.slice(0, 5).map(j => `
- ${j.title}: Started ${j.startDate || "unknown"}, Ended ${j.endDate || "unknown"}
- Estimated: $${j.estimatedCost || "N/A"}, Actual: $${j.actualCost || "N/A"}
`).join("\n")}

AVAILABLE TEAM:
${subcontractors.slice(0, 5).map(sub => `
- ${sub.name}: Skills: ${sub.skills?.join(", ") || "None"}, Rating: ${sub.rating || "N/A"}
`).join("\n")}

Predict the project timeline in the following JSON format:
{
  "estimatedDuration": number (days),
  "confidence": number (0-100),
  "milestones": [
    {
      "name": "milestone name",
      "date": "YYYY-MM-DD",
      "description": "detailed description"
    }
  ],
  "riskFactors": [
    "list of potential delays or issues"
  ],
  "recommendations": [
    "actionable recommendations for timeline optimization"
  ]
}

Consider factors like:
- Project complexity and scope
- Historical performance patterns
- Team availability and skill levels
- Seasonal and weather impacts
- Client requirements and deadlines
- Resource dependencies
- Potential bottlenecks and risks
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      return JSON.parse(response.choices[0].message.content || "{}");

    } catch (error) {
      console.error("Error in AI timeline prediction:", error);
      throw new Error("Failed to predict project timeline");
    }
  }
}

export const aiScheduler = new AIScheduler();