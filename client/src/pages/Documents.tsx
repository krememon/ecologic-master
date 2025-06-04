import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  FolderOpen, 
  FileText, 
  Image, 
  FileSpreadsheet, 
  Download,
  Search,
  Upload,
  Filter
} from "lucide-react";

export default function Documents() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: documents, isLoading: documentsLoading } = useQuery({
    queryKey: ["/api/documents"],
    enabled: isAuthenticated,
  });

  const getFileIcon = (type: string) => {
    switch (type) {
      case "contract":
      case "permit":
        return <FileText className="w-8 h-8 text-blue-600" />;
      case "blueprint":
        return <FileSpreadsheet className="w-8 h-8 text-green-600" />;
      case "photo":
        return <Image className="w-8 h-8 text-purple-600" />;
      case "receipt":
        return <FileText className="w-8 h-8 text-orange-600" />;
      default:
        return <FileText className="w-8 h-8 text-slate-600" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "contract":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "permit":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "blueprint":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "photo":
        return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300";
      case "receipt":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (isLoading || !isAuthenticated || documentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar user={user} company={user?.company} />
      <main className="flex-1 overflow-auto">
        <Header 
          title="Documents"
          subtitle="Organize and manage your project files and documents"
          user={user}
        />
        
        <div className="p-6">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input 
                placeholder="Search documents..." 
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Select>
                <SelectTrigger className="w-40">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="contract">Contracts</SelectItem>
                  <SelectItem value="permit">Permits</SelectItem>
                  <SelectItem value="blueprint">Blueprints</SelectItem>
                  <SelectItem value="photo">Photos</SelectItem>
                  <SelectItem value="receipt">Receipts</SelectItem>
                </SelectContent>
              </Select>
              <Button>
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </Button>
            </div>
          </div>

          {/* Document Categories */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            {[
              { name: "Contracts", type: "contract", count: 0, color: "bg-blue-100 text-blue-800" },
              { name: "Permits", type: "permit", count: 0, color: "bg-green-100 text-green-800" },
              { name: "Blueprints", type: "blueprint", count: 0, color: "bg-purple-100 text-purple-800" },
              { name: "Photos", type: "photo", count: 0, color: "bg-pink-100 text-pink-800" },
              { name: "Receipts", type: "receipt", count: 0, color: "bg-orange-100 text-orange-800" },
            ].map((category) => (
              <Card key={category.type} className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    {getFileIcon(category.type)}
                  </div>
                  <h3 className="font-medium text-slate-900 dark:text-slate-100">{category.name}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {category.count} files
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Documents List */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Documents</CardTitle>
            </CardHeader>
            <CardContent>
              {!documents || documents.length === 0 ? (
                <div className="py-16 text-center">
                  <FolderOpen className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    No documents found
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mb-6">
                    Upload your first document to start organizing your project files.
                  </p>
                  <Button>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Document
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* This would be populated with actual documents from the API */}
                  <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">Sample Document</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          No actual documents - this is a demo view
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                        Contract
                      </Badge>
                      <Button variant="ghost" size="sm">
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
