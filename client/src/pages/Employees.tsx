import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Users, Ban, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: "OWNER" | "SUPERVISOR" | "TECHNICIAN" | "DISPATCHER" | "ESTIMATOR";
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

export default function Employees() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [confirmAction, setConfirmAction] = useState<{
    type: "role" | "status";
    userId: string;
    currentRole?: string;
    newValue: any;
  } | null>(null);
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
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return apiRequest(`/api/org/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
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
    mutationFn: async ({ userId, status }: { userId: string; status: string }) => {
      return apiRequest(`/api/org/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
      toast({
        title: "Status Updated",
        description: "Employee status has been updated successfully",
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

  const handleRoleChange = (userId: string, currentRole: string, newRole: string) => {
    if (currentRole === "OWNER" || newRole === "OWNER") {
      setConfirmAction({ type: "role", userId, currentRole, newValue: newRole });
    } else {
      updateRoleMutation.mutate({ userId, role: newRole });
    }
  };

  const handleStatusToggle = (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    setConfirmAction({ type: "status", userId, currentRole: "", newValue: newStatus });
  };

  const confirmActionHandler = () => {
    if (!confirmAction) return;

    if (confirmAction.type === "role") {
      updateRoleMutation.mutate({ userId: confirmAction.userId, role: confirmAction.newValue });
    } else {
      updateStatusMutation.mutate({ userId: confirmAction.userId, status: confirmAction.newValue });
    }

    setConfirmAction(null);
  };

  const employees = data?.users || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage your team members and their roles</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Roster</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
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
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading employees...</div>
          ) : employees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No employees yet</h3>
              <p className="text-muted-foreground">
                Share your company code from Settings → Company to add your team.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee) => (
                    <TableRow key={employee.id} data-testid={`row-employee-${employee.id}`}>
                      <TableCell className="font-medium">
                        {employee.firstName} {employee.lastName}
                      </TableCell>
                      <TableCell>{employee.email}</TableCell>
                      <TableCell>
                        <Select
                          value={employee.role}
                          onValueChange={(value) =>
                            handleRoleChange(employee.id, employee.role, value)
                          }
                          disabled={updateRoleMutation.isPending}
                        >
                          <SelectTrigger className="w-[140px]" data-testid={`select-role-${employee.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={employee.status === "active" ? "default" : "secondary"}
                          data-testid={`badge-status-${employee.id}`}
                        >
                          {employee.status === "active" ? (
                            <CheckCircle className="w-3 h-3 mr-1" />
                          ) : (
                            <Ban className="w-3 h-3 mr-1" />
                          )}
                          {employee.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {employee.lastLoginAt
                          ? format(new Date(employee.lastLoginAt), "MMM d, yyyy")
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant={employee.status === "active" ? "outline" : "default"}
                          size="sm"
                          onClick={() => handleStatusToggle(employee.id, employee.status)}
                          disabled={updateStatusMutation.isPending}
                          data-testid={`button-toggle-status-${employee.id}`}
                        >
                          {employee.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "role" && confirmAction.newValue === "OWNER"
                ? "You are about to promote this user to Owner. Owners have full control over the organization."
                : confirmAction?.type === "role" && confirmAction.currentRole === "OWNER"
                ? "You are about to demote an Owner. Make sure at least one Owner remains in the organization."
                : confirmAction?.type === "status" && confirmAction.newValue === "inactive"
                ? "You are about to deactivate this user. They will no longer be able to access the system."
                : "You are about to reactivate this user. They will regain access to the system."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmActionHandler}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
