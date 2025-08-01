import { Sidebar } from "@/components/layout/sidebar";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { ChartsSection } from "@/components/dashboard/charts-section";
import { IntegrationsStatus } from "@/components/dashboard/integrations-status";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { Button } from "@/components/ui/button";
import { RefreshCw, Download, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function Dashboard() {
  const { data: overview, refetch: refetchOverview } = useQuery({
    queryKey: ["/api/analytics/overview"],
  });

  const { data: insights } = useQuery({
    queryKey: ["/api/analytics/insights"],
  });

  const handleRefresh = () => {
    refetchOverview();
  };

  const handleExport = () => {
    // TODO: Implement data export functionality
    console.log("Exporting data...");
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-surface shadow-sm border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground" data-testid="dashboard-title">
                Dashboard Overview
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Monitor your Slack app performance and user analytics
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleRefresh}
                data-testid="button-refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button 
                onClick={handleExport}
                data-testid="button-export"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Data
              </Button>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <MetricsCards data={overview} />
          <ChartsSection insights={insights} />
          <IntegrationsStatus />
          <RecentActivity />
        </div>
      </main>

      {/* Floating Action Button */}
      <Button
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg hover:scale-105 transition-transform"
        size="sm"
        data-testid="button-quick-actions"
      >
        <Plus className="h-5 w-5" />
      </Button>
    </div>
  );
}
