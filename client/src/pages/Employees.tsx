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

interface SeatStatus {
  ok: boolean;
  seatCount: number;
  seatLimit: number;
  atLimit: boolean;
  planKey: string | null;
}

type UserRole = "OWNER" | "SUPERVISOR" | "TECHNICIAN";

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
  profileImageUrl?: string | null;
}

const roleOptions = [
  { value: "OWNER", label: "Owner" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "TECHNICIAN", label: "Technician" },
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

  const { data: seatStatus } = useQuery<SeatStatus>({
    queryKey: ["/api/billing/seat-status"],
    retry: false,
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const removeEmployeeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/org/users/${userId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to remove employee");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/seat-status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove employee",
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

  const handleRemoveEmployee = (userId: string) => {
    removeEmployeeMutation.mutate(userId);
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
          TECHNICIAN: 3,
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
  const isRemoving = removeEmployeeMutation.isPending;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage your team members and their roles</p>
          {seatStatus?.ok && (
            <div className="flex items-center gap-2 mt-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                seatStatus.atLimit
                  ? 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}>
                {seatStatus.seatCount} of {seatStatus.seatLimit} seat{seatStatus.seatLimit !== 1 ? 's' : ''} used
              </span>
              {seatStatus.atLimit && (
                <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                  Plan limit reached
                </span>
              )}
            </div>
          )}
        </div>
        <InviteTeamButton
          atLimit={seatStatus?.atLimit ?? false}
          seatCount={seatStatus?.seatCount}
          seatLimit={seatStatus?.seatLimit}
        />
      </div>

      {/* Filters and Sort */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
            <div className="flex-1 relative min-w-[200px]">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-employees"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-role-filter">
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
                <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-sort">
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
              onRemove={handleRemoveEmployee}
              isUpdating={isUpdating}
              isRemoving={isRemoving}
            />
          ))}
        </div>
      )}
    </div>
  );
}
