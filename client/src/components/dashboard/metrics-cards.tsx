import { Users, Clock, Calendar, Target } from "lucide-react";

interface MetricsCardsProps {
  data?: {
    activeUsers: string;
    totalMeetings: string;
    focusTime: string;
    productivityScore: string;
  };
}

export function MetricsCards({ data }: MetricsCardsProps) {
  const metrics = [
    {
      name: "Active Users",
      value: data?.activeUsers || "0",
      icon: Users,
      change: "+12%",
      changeType: "positive" as const,
    },
    {
      name: "Total Meetings",
      value: data?.totalMeetings || "0",
      icon: Calendar,
      change: "+8%",
      changeType: "positive" as const,
    },
    {
      name: "Focus Time",
      value: data?.focusTime || "0h",
      icon: Clock,
      change: "+15%",
      changeType: "positive" as const,
    },
    {
      name: "Productivity Score",
      value: data?.productivityScore || "0%",
      icon: Target,
      change: "+5%",
      changeType: "positive" as const,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.name}
            className="bg-card rounded-lg border border-border p-6 shadow-sm"
            data-testid={`metric-${metric.name.toLowerCase().replace(' ', '-')}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
              </div>
              <span
                className={`text-sm font-medium ${
                  metric.changeType === "positive"
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {metric.change}
              </span>
            </div>
            <div className="mt-4">
              <h3 className="text-2xl font-bold text-foreground" data-testid={`text-${metric.name.toLowerCase().replace(' ', '-')}-value`}>
                {metric.value}
              </h3>
              <p className="text-sm text-muted-foreground">{metric.name}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}