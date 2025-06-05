import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolderOpen, FileText, Upload, Download, PenTool } from "lucide-react";
import ApprovalWorkflow from "@/components/ApprovalWorkflow";

export default function Documents() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();

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

  const { data: documents = [], isLoading: documentsLoading } = useQuery({
    queryKey: ["/api/documents"],
    enabled: isAuthenticated,
  });

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Documents & Approvals</h1>
          <p className="text-slate-600 dark:text-slate-400">Manage project documents and e-signature approval workflows</p>
        </div>
      </div>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="approvals" className="flex items-center gap-2">
            <PenTool className="h-4 w-4" />
            E-signature Approvals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              All Documents ({documents.length})
            </h3>
            <Button>
              <Upload className="w-4 h-4 mr-2" />
              Upload Document
            </Button>
          </div>

          {documentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-slate-500">Loading documents...</div>
            </div>
          ) : documents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FolderOpen className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No documents yet</h3>
                <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
                  Upload contracts, plans, and other project documents.
                </p>
                <Button>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Your First Document
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {documents.map((document: any) => (
                <Card key={document.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span className="truncate">{document.name}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {document.type || 'File'}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                        <span>Size: {((document.size || 0) / 1024).toFixed(1)} KB</span>
                        <span>{new Date(document.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1">
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="approvals" className="mt-6">
          <ApprovalWorkflow />
        </TabsContent>
      </Tabs>
    </div>
  );
}