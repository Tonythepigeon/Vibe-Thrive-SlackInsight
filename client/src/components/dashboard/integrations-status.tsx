import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export function IntegrationsStatus() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["/api/integrations/status"],
  });

  const integrations = [
    {
      name: "Google Calendar",
      status: status?.googleCalendar?.connected ? "connected" : "disconnected",
      description: status?.googleCalendar?.name || "Connect to sync your meetings",
    },
    {
      name: "Microsoft Outlook",
      status: status?.microsoftOutlook?.connected ? "connected" : "disconnected", 
      description: status?.microsoftOutlook?.name || "Connect to sync your Outlook calendar",
    },
    {
      name: "Slack Workspace",
      status: status?.slack?.connected ? "connected" : "disconnected",
      description: status?.slack?.name || "Connect your Slack workspace",
    },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "disconnected":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Integration Status</h3>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Integration Status</h3>
      <div className="space-y-4">
        {integrations.map((integration) => (
          <div key={integration.name} className="flex items-center justify-between" data-testid={`integration-${integration.name.toLowerCase().replace(' ', '-')}`}>
            <div className="flex items-center space-x-3">
              {getStatusIcon(integration.status)}
              <div>
                <h4 className="font-medium text-foreground">{integration.name}</h4>
                <p className="text-sm text-muted-foreground">{integration.description}</p>
              </div>
            </div>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                integration.status === "connected"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              }`}
              data-testid={`status-${integration.name.toLowerCase().replace(' ', '-')}`}
            >
              {integration.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}