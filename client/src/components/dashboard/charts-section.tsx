interface ChartsSectionProps {
  insights?: Array<{
    type: string;
    icon: string;
    title: string;
    description: string;
    value: string;
  }>;
}

export function ChartsSection({ insights }: ChartsSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Productivity Insights</h3>
        <div className="space-y-4">
          {insights?.map((insight, index) => (
            <div key={index} className="flex items-start space-x-3" data-testid={`insight-${insight.type}`}>
              <div className="text-2xl">{insight.icon}</div>
              <div className="flex-1">
                <h4 className="font-medium text-foreground">{insight.title}</h4>
                <p className="text-sm text-muted-foreground">{insight.description}</p>
                <span className="text-sm font-medium text-primary">{insight.value}</span>
              </div>
            </div>
          )) || (
            <p className="text-muted-foreground text-center py-8">
              No insights available yet. Connect your calendar to see productivity data.
            </p>
          )}
        </div>
      </div>
      
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Weekly Trends</h3>
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          <p>Chart visualization coming soon</p>
        </div>
      </div>
    </div>
  );
}