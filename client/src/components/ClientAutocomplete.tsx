import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Client {
  id: number;
  name: string;
  email?: string;
  phone?: string;
}

interface ClientAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function ClientAutocomplete({ 
  value, 
  onChange, 
  placeholder = "Enter client name...",
  className 
}: ClientAutocompleteProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch clients from the API
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['/api/clients'],
  });

  // Filter clients based on current value
  const filteredClients = clients.filter(client =>
    value.length > 0 && client.name.toLowerCase().includes(value.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setShowDropdown(newValue.length > 0);
  };

  const handleSelectClient = (clientName: string) => {
    onChange(clientName);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const handleInputFocus = () => {
    if (value.length > 0) {
      setShowDropdown(true);
    }
  };

  const handleInputBlur = (e: React.FocusEvent) => {
    // Don't close if clicking on dropdown
    if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
      setTimeout(() => setShowDropdown(false), 150);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const shouldShowDropdown = showDropdown && value.length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn("pr-8", className)}
          data-testid="input-client-autocomplete"
        />
        <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
      </div>
      
      {shouldShowDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {filteredClients.length > 0 ? (
            filteredClients.map((client) => (
              <div
                key={client.id}
                className="px-3 py-2 hover:bg-slate-100 cursor-pointer border-b border-slate-100 last:border-b-0"
                onClick={() => handleSelectClient(client.name)}
                data-testid={`option-client-${client.id}`}
              >
                <div className="font-medium text-slate-900">{client.name}</div>
                {client.email && (
                  <div className="text-sm text-slate-500">{client.email}</div>
                )}
              </div>
            ))
          ) : value.length >= 2 ? (
            <div className="px-3 py-3 text-center text-sm text-slate-500">
              No existing clients found. Type to create "{value}" as a new client.
            </div>
          ) : (
            <div className="px-3 py-3 text-center text-sm text-slate-500">
              Type to search existing clients...
            </div>
          )}
        </div>
      )}
    </div>
  );
}