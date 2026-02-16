import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, MoreVertical, Edit, UserX, UserCheck, ChevronDown, ChevronRight, Briefcase, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCan } from "@/hooks/useCan";
import JobsHistory from "./JobsHistory.tsx";
import { formatPhone } from "@shared/phoneUtils";

type UserRole = "OWNER" | "SUPERVISOR" | "TECHNICIAN";

interface EmployeeCardProps {
  employee: {
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
    createdAt: string;
    isClockedIn?: boolean;
  };
  onRoleChange: (userId: string, newRole: UserRole) => void;
  onStatusToggle: (userId: string, newStatus: 'active' | 'inactive') => void;
  onRemove: (userId: string) => void;
  isUpdating: boolean;
  isRemoving: boolean;
}

export default function EmployeeCard({ employee, onRoleChange, onStatusToggle, onRemove, isUpdating, isRemoving }: EmployeeCardProps) {
  const { can } = useCan();
  const [isJobsExpanded, setIsJobsExpanded] = useState(false);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(employee.role);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);

  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  
  // Format address
  const formatAddress = () => {
    const parts = [
      employee.addressLine1,
      employee.addressLine2,
      employee.city,
      employee.state,
      employee.postalCode,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const address = formatAddress();

  // Role badge colors
  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'OWNER':
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
      case 'SUPERVISOR':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
      case 'TECHNICIAN':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const getRoleLabel = (role: string) => {
    return role.charAt(0) + role.slice(1).toLowerCase();
  };

  const handleRoleChangeSubmit = () => {
    onRoleChange(employee.id, selectedRole);
    setIsRoleDialogOpen(false);
  };

  const handleStatusToggle = () => {
    const newStatus = employee.status === 'ACTIVE' ? 'inactive' : 'active';
    onStatusToggle(employee.id, newStatus);
    setIsStatusDialogOpen(false);
  };

  const canModify = can('users.manage') && employee.role !== 'OWNER';

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`card-employee-${employee.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={getRoleBadgeColor(employee.role)} data-testid={`badge-role-${employee.id}`}>
                {getRoleLabel(employee.role)}
              </Badge>
              <Badge 
                className={employee.isClockedIn
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }
                data-testid={`badge-status-${employee.id}`}
              >
                {employee.isClockedIn ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <CardTitle className="text-xl" data-testid={`text-employee-name-${employee.id}`}>
              {fullName}
            </CardTitle>
          </div>
          
          <div className="flex items-center gap-2">
            {canModify && (
              <TooltipProvider>
                <Tooltip>
                  <AlertDialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-slate-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          data-testid={`button-remove-${employee.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Remove from company</p>
                    </TooltipContent>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove from company?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will immediately revoke access to your company. The user's account remains but they'll need a new company invite code to continue.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => {
                            onRemove(employee.id);
                            setIsRemoveDialogOpen(false);
                          }}
                          disabled={isRemoving}
                          className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                          {isRemoving ? 'Removing...' : 'Remove'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {can('users.view') && (
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" data-testid={`button-kebab-${employee.id}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canModify && (
                  <AlertDialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-testid={`menu-change-role-${employee.id}`}>
                        <Edit className="h-4 w-4 mr-2" />
                        Change Role
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Change Role</AlertDialogTitle>
                        <AlertDialogDescription>
                          Select a new role for {fullName}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="py-4">
                        <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as UserRole)}>
                          <SelectTrigger data-testid={`select-new-role-${employee.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                            <SelectItem value="TECHNICIAN">Technician</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRoleChangeSubmit} disabled={isUpdating}>
                          {isUpdating ? 'Updating...' : 'Change Role'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                
                {canModify && (
                  <AlertDialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-testid={`menu-toggle-status-${employee.id}`}>
                        {employee.status === 'ACTIVE' ? (
                          <>
                            <UserX className="h-4 w-4 mr-2" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-4 w-4 mr-2" />
                            Activate
                          </>
                        )}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {employee.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} Employee
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to {employee.status === 'ACTIVE' ? 'deactivate' : 'activate'} {fullName}?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleStatusToggle} disabled={isUpdating}>
                          {isUpdating ? 'Updating...' : 'Confirm'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-2">
        {employee.email && (
          <a 
            href={`mailto:${employee.email}`}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
            data-testid={`link-email-${employee.id}`}
          >
            <Mail className="h-4 w-4" />
            {employee.email}
          </a>
        )}
        
        {employee.phone && (
          <a 
            href={`tel:${employee.phone}`}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
            data-testid={`link-phone-${employee.id}`}
          >
            <Phone className="h-4 w-4" />
            {formatPhone(employee.phone)}
          </a>
        )}
        
        {address && (
          <button
            onClick={() => {
              const encodedAddress = encodeURIComponent(address);
              if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
                window.open(`maps://maps.apple.com/?q=${encodedAddress}`, '_self');
              } else if (navigator.userAgent.includes('Android')) {
                window.open(`geo:0,0?q=${encodedAddress}`, '_self');
              } else {
                window.open(`https://maps.google.com/?q=${encodedAddress}`, '_blank');
              }
            }}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer text-left"
            data-testid={`link-address-${employee.id}`}
          >
            <MapPin className="h-4 w-4" />
            {address}
          </button>
        )}
        
        {!employee.phone && !address && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>—</span>
          </div>
        )}
        
        {/* Jobs History Section */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setIsJobsExpanded(!isJobsExpanded)}
            className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 w-full text-left"
            aria-expanded={isJobsExpanded}
            aria-controls={`jobs-history-${employee.id}`}
            data-testid={`button-jobs-history-${employee.id}`}
          >
            {isJobsExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Briefcase className="h-4 w-4" />
            <span className="font-medium">Jobs History</span>
          </button>
          
          {isJobsExpanded && (
            <div id={`jobs-history-${employee.id}`}>
              <JobsHistory userId={employee.id} />
            </div>
          )}
        </div>
        
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500">
            Joined {new Date(employee.createdAt).toLocaleDateString()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
