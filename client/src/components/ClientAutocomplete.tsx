import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch clients from the API
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['/api/clients'],
    enabled: open || searchTerm.length > 0, // Only fetch when needed
  });

  // Filter clients based on search term
  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Update search term when value changes externally
  useEffect(() => {
    setSearchTerm(value);
  }, [value]);

  const handleInputChange = (newValue: string) => {
    setSearchTerm(newValue);
    onChange(newValue);
    if (!open && newValue.length > 0) {
      setOpen(true);
    }
  };

  const handleSelectClient = (clientName: string) => {
    setSearchTerm(clientName);
    onChange(clientName);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && !open) {
      setOpen(true);
    }
  };

  const handleInputBlur = () => {
    // Delay closing to allow for click selection
    setTimeout(() => setOpen(false), 200);
  };

  const showDropdown = open && searchTerm.length > 0 && (filteredClients.length > 0 || searchTerm.length >= 2);

  return (
    <Popover open={showDropdown} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            value={searchTerm}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            onFocus={() => searchTerm.length > 0 && setOpen(true)}
            placeholder={placeholder}
            className={cn("pr-8", className)}
            data-testid="input-client-autocomplete"
          />
          <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandList>
            {filteredClients.length > 0 ? (
              <CommandGroup>
                {filteredClients.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={client.name}
                    onSelect={() => handleSelectClient(client.name)}
                    className="flex items-center gap-2 cursor-pointer"
                    data-testid={`option-client-${client.id}`}
                  >
                    <Check className={cn("h-4 w-4", value === client.name ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1">
                      <div className="font-medium">{client.name}</div>
                      {client.email && (
                        <div className="text-sm text-slate-500">{client.email}</div>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : searchTerm.length >= 2 ? (
              <CommandEmpty className="py-3 text-center text-sm text-slate-500">
                No existing clients found. Type to create "{searchTerm}" as a new client.
              </CommandEmpty>
            ) : (
              <CommandEmpty className="py-3 text-center text-sm text-slate-500">
                Type to search existing clients...
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}