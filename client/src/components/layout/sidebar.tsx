import { Link, useLocation } from "wouter";
import { BarChart3, Settings, Calendar, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: BarChart3 },
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "Team", href: "/team", icon: Users },
  { name: "Focus Mode", href: "/focus", icon: Zap },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex flex-col w-64 bg-card border-r border-border">
      <div className="flex items-center h-16 px-6 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Productivity Hub</h2>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-1">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              data-testid={`nav-${item.name.toLowerCase()}`}
            >
              <Icon className="h-5 w-5 mr-3" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}