import { useQuery } from "@tanstack/react-query";

interface Client {
  id: number;
  name: string;
  email?: string;
  phone?: string;
}

interface ClientSuggestionsProps {
  searchTerm: string;
  onSelect: (client: { id: number; name: string }) => void;
}

export function ClientSuggestions({ searchTerm, onSelect }: ClientSuggestionsProps) {
  // Fetch clients from the API
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['/api/clients'],
  });

  // Filter clients based on search term
  const filteredClients = clients.filter(client =>
    searchTerm.length > 0 && 
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    client.name.toLowerCase() !== searchTerm.toLowerCase() // Don't show if exact match
  );

  if (!searchTerm || searchTerm.length < 1 || filteredClients.length === 0) {
    return null;
  }

  return (
    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
      {filteredClients.slice(0, 5).map((client) => (
        <div
          key={client.id}
          className="px-3 py-2 hover:bg-slate-100 cursor-pointer border-b border-slate-100 last:border-b-0"
          onClick={() => onSelect({ id: client.id, name: client.name })}
          data-testid={`suggestion-client-${client.id}`}
        >
          <div className="font-medium text-slate-900">{client.name}</div>
          {client.email && (
            <div className="text-sm text-slate-500">{client.email}</div>
          )}
        </div>
      ))}
    </div>
  );
}