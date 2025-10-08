import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Users, ArrowUpDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import EmployeeCard from "@/components/employees/EmployeeCard";
import InviteTeamButton from "@/components/employees/InviteTeamButton";

type UserRole = "OWNER" | "SUPERVISOR" | "TECHNICIAN" | "DISPATCHER" | "ESTIMATOR";

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  role: UserRole;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

const roleOptions = [
  { value: "OWNER", label: "Owner" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "TECHNICIAN", label: "Technician" },
  { value: "DISPATCHER", label: "Dispatcher" },
  { value: "ESTIMATOR", label: "Estimator" },
];

const sortOptions = [
  { value: "name", label: "Name A-Z" },
  { value: "role", label: "Role" },
  { value: "joined", label: "Joined (Newest)" },
];

export default function Employees() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ users: Employee[]; total: number }>({
    queryKey: ["/api/org/users", search, roleFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (roleFilter !== "all") params.append("role", roleFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);

      const response = await fetch(`/api/org/users?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch employees");
      return response.json();
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const res = await apiRequest("PATCH", `/api/org/users/${userId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
      toast({
        title: "Role Updated",
        description: "Employee role has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update role",
        variant: "destructive",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: 'ACTIVE' | 'INACTIVE' }) => {
      const res = await apiRequest("PATCH", `/api/org/users/${userId}`, { status });
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
      const action = variables.status === 'INACTIVE' ? 'deactivated and signed out' : 'activated';
      toast({
        title: "Status Updated",
        description: `Employee was ${action} successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    updateRoleMutation.mutate({ userId, role: newRole });
  };

  const handleStatusToggle = (userId: string, newStatus: 'active' | 'inactive') => {
    const uppercaseStatus = newStatus === 'active' ? 'ACTIVE' : 'INACTIVE';
    updateStatusMutation.mutate({ userId, status: uppercaseStatus });
  };

  // Sort employees
  const sortEmployees = (employees: Employee[]) => {
    const sorted = [...employees];
    
    switch (sortBy) {
      case "name":
        return sorted.sort((a, b) => {
          const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
          const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
          return nameA.localeCompare(nameB);
        });
      case "role":
        const roleWeight: Record<UserRole, number> = {
          OWNER: 1,
          SUPERVISOR: 2,
          DISPATCHER: 3,
          ESTIMATOR: 4,
          TECHNICIAN: 5,
        };
        return sorted.sort((a, b) => roleWeight[a.role] - roleWeight[b.role]);
      case "joined":
        return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      default:
        return sorted;
    }
  };

  const employees = sortEmployees(data?.users || []);
  const isUpdating = updateRoleMutation.isPending || updateStatusMutation.isPending;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage your team members and their roles</p>
        </div>
        <InviteTeamButton />
      </div>

      {/* Filters and Sort */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-employees"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-role-filter">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roleOptions.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-sort">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Employee Count */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Employees ({employees.length})
        </h3>
      </div>

      {/* Employee Cards Grid */}
      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6 space-y-4">
                <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
              No employees match your filters
            </h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              {data?.total === 0 
                ? "Share your company code from Settings → Company to add your team."
                : "Try adjusting your search or filter criteria."}
            </p>
            <Link href="/settings">
              <Button>
                <Users className="h-4 w-4 mr-2" />
                Invite Team
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {employees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onRoleChange={handleRoleChange}
              onStatusToggle={handleStatusToggle}
              isUpdating={isUpdating}
            />
          ))}
        </div>
      )}
    </div>
  );
}
