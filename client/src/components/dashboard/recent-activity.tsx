import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock, Users, Zap } from "lucide-react";

export function RecentActivity() {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["/api/activity"],
  });

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "meeting":
        return <Calendar className="h-4 w-4 text-blue-500" />;
      case "focus":
        return <Zap className="h-4 w-4 text-purple-500" />;
      case "break":
        return <Clock className="h-4 w-4 text-green-500" />;
      default:
        return <Users className="h-4 w-4 text-gray-500" />;
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse flex items-center space-x-3">
              <div className="h-8 w-8 bg-muted rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-muted rounded w-3/4 mb-1"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
      <div className="space-y-4">
        {activities && activities.length > 0 ? (
          activities.slice(0, 10).map((activity: any, index: number) => (
            <div key={index} className="flex items-start space-x-3" data-testid={`activity-${index}`}>
              <div className="p-2 bg-muted rounded-full">
                {getActivityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{activity.description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8">
            <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No recent activity</p>
            <p className="text-sm text-muted-foreground mt-1">
              Connect your integrations to start tracking activity
            </p>
          </div>
        )}
      </div>
    </div>
  );
}