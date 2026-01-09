import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Customer } from "@shared/schema";

export interface CreateCustomerData {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address?: string;
  companyName?: string;
  companyNumber?: string;
  jobTitle?: string;
}

export function useCompanyCustomers() {
  const { 
    data: customers = [], 
    isLoading, 
    error,
    refetch: refetchCustomers 
  } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (customerData: CreateCustomerData) => {
      const response = await apiRequest('POST', '/api/customers', customerData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
    },
  });

  return {
    customers,
    isLoading,
    error,
    refetchCustomers,
    createCustomer: createCustomerMutation.mutateAsync,
    isCreating: createCustomerMutation.isPending,
    createError: createCustomerMutation.error,
  };
}
