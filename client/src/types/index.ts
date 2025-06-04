export interface User {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  company?: Company;
}

export interface Company {
  id: number;
  name: string;
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Client {
  id: number;
  companyId: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subcontractor {
  id: number;
  companyId: number;
  name: string;
  email?: string;
  phone?: string;
  skills?: string[];
  rating?: number;
  isAvailable: boolean;
  hourlyRate?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Job {
  id: number;
  companyId: number;
  clientId: number;
  title: string;
  description?: string;
  status: "planning" | "in_progress" | "completed" | "cancelled" | "urgent";
  priority: "low" | "medium" | "high" | "urgent";
  startDate?: string;
  endDate?: string;
  estimatedCost?: number;
  actualCost?: number;
  location?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  client: {
    id: number;
    name: string;
    email?: string;
    phone?: string;
  };
}

export interface Invoice {
  id: number;
  companyId: number;
  jobId?: number;
  clientId: number;
  invoiceNumber: string;
  amount: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
  issueDate: string;
  dueDate: string;
  paidDate?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  client: {
    id: number;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  job?: {
    id: number;
    title: string;
  };
}

export interface Document {
  id: number;
  companyId: number;
  jobId?: number;
  name: string;
  type?: "contract" | "permit" | "blueprint" | "receipt" | "photo";
  fileUrl: string;
  fileSize?: number;
  uploadedBy?: string;
  createdAt: Date;
}

export interface Message {
  id: number;
  companyId: number;
  jobId?: number;
  senderId: string;
  recipientId?: string;
  subject?: string;
  content: string;
  isRead: boolean;
  createdAt: Date;
  sender: {
    id: string;
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
  };
  job?: {
    id: number;
    title: string;
  };
}

export interface DashboardStats {
  activeJobs: number;
  outstandingInvoices: {
    count: number;
    amount: number;
  };
  availableSubcontractors: number;
  monthlyRevenue: number;
}
