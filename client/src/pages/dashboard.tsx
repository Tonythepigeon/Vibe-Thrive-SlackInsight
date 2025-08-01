import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calendar, Clock, Coffee, Target, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Meeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  attendees: any[];
  meetingType: string;
}

interface DashboardData {
  user: {
    id: string;
    name: string;
    timezone: string;
  };
  meetings: Meeting[];
  metrics: any[];
  weekRange: {
    start: string;
    end: string;
  };
}

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [showTestDataButton, setShowTestDataButton] = useState(false);

  // Extract user ID from URL or get from localStorage/context
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const userIdFromUrl = urlParams.get('userId');
    if (userIdFromUrl) {
      setUserId(userIdFromUrl);
      localStorage.setItem('userId', userIdFromUrl);
    } else {
      const storedUserId = localStorage.getItem('userId');
      setUserId(storedUserId);
    }
  }, []);

  const { data, refetch, isLoading, error } = useQuery<DashboardData>({
    queryKey: [`/api/dashboard/${userId}`],
    enabled: !!userId,
    retry: false,
  });

  const generateTestData = async () => {
    if (!userId) return;
    
    try {
      const response = await fetch("/api/generate-test-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });
      
      if (response.ok) {
        refetch();
        setShowTestDataButton(false);
      }
    } catch (error) {
      console.error("Failed to generate test data:", error);
    }
  };

  const clearDemoData = async () => {
    if (!userId) return;
    
    try {
      const response = await fetch("/api/clear-demo-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });
      
      if (response.ok) {
        refetch();
      }
    } catch (error) {
      console.error("Failed to clear demo data:", error);
    }
  };

  const formatTime = (dateString: string, timezone: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDate = (dateString: string, timezone: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const getMeetingStatus = (meeting: Meeting, timezone: string) => {
    const now = new Date();
    const startTime = new Date(meeting.startTime);
    const endTime = new Date(meeting.endTime);
    
    if (now >= startTime && now <= endTime) {
      return { status: 'in-progress', color: 'bg-red-500', text: 'In Progress' };
    } else if (now > endTime) {
      return { status: 'completed', color: 'bg-green-500', text: 'Completed' };
    } else {
      const minutesUntil = Math.floor((startTime.getTime() - now.getTime()) / (1000 * 60));
      if (minutesUntil <= 15) {
        return { status: 'starting-soon', color: 'bg-yellow-500', text: 'Starting Soon' };
      }
      return { status: 'upcoming', color: 'bg-blue-500', text: 'Upcoming' };
    }
  };

  const groupMeetingsByDate = (meetings: Meeting[], timezone: string) => {
    const grouped: { [key: string]: Meeting[] } = {};
    
    meetings.forEach(meeting => {
      const dateKey = formatDate(meeting.startTime, timezone);
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(meeting);
    });
    
    return grouped;
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-4">Welcome to ProductivityWise</h2>
          <p className="text-muted-foreground mb-4">Please access this dashboard from Slack using the "View Full Dashboard" button in your productivity summary.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading your productivity dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-4">Let's get started!</h2>
          <p className="text-muted-foreground mb-4">Generate some demo meeting data to see your productivity dashboard in action.</p>
          <Button onClick={generateTestData} className="mb-4">
            <Calendar className="h-4 w-4 mr-2" />
            Generate Demo Data
          </Button>
        </div>
      </div>
    );
  }

  const { user, meetings, weekRange } = data;
  const groupedMeetings = groupMeetingsByDate(meetings, user.timezone);
  
  // Calculate stats
  const totalMeetings = meetings.length;
  const totalMeetingTime = meetings.reduce((sum, meeting) => sum + meeting.duration, 0);
  const avgMeetingDuration = totalMeetings > 0 ? Math.round(totalMeetingTime / totalMeetings) : 0;
  
  const todayKey = formatDate(new Date().toISOString(), user.timezone);
  const todaysMeetings = groupedMeetings[todayKey] || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {user.name}!</h1>
          <p className="text-muted-foreground">Here's your productivity overview for this week</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={generateTestData} variant="outline">
            <Calendar className="h-4 w-4 mr-2" />
            Generate New Data
          </Button>
          <Button onClick={clearDemoData} variant="outline">
            <Target className="h-4 w-4 mr-2" />
            Clear Focus & Breaks
          </Button>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week's Meetings</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMeetings}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Meeting Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.floor(totalMeetingTime / 60)}h {totalMeetingTime % 60}m
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Meeting</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgMeetingDuration}min</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Meetings</CardTitle>
            <Coffee className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todaysMeetings.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Calendar View */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Calendar className="h-5 w-5 mr-2" />
            Meeting Calendar
          </CardTitle>
          <CardDescription>
            Your meetings for {formatDate(weekRange.start, user.timezone)} - {formatDate(weekRange.end, user.timezone)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(groupedMeetings).length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No meetings scheduled</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedMeetings)
                .sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime())
                .map(([date, dayMeetings]) => (
                  <div key={date}>
                    <h3 className={`font-semibold text-lg mb-3 flex items-center ${
                      date === todayKey 
                        ? 'p-3 bg-blue-50 border-l-4 border-blue-500 rounded-r-lg' 
                        : ''
                    }`}>
                      {date}
                      {date === todayKey && (
                        <Badge variant="default" className="ml-2 bg-blue-500 hover:bg-blue-600">Today</Badge>
                      )}
                    </h3>
                    <div className={`space-y-2 ${
                      date === todayKey ? 'ml-4' : ''
                    }`}>
                      {dayMeetings
                        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                        .map((meeting) => {
                          const status = getMeetingStatus(meeting, user.timezone);
                          return (
                            <div key={meeting.id} className="flex items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                              <div className={`w-3 h-3 rounded-full ${status.color} mr-3`} />
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-medium">{meeting.title}</h4>
                                  <Badge variant="outline">{status.text}</Badge>
                                </div>
                                <div className="flex items-center text-sm text-muted-foreground mt-1">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatTime(meeting.startTime, user.timezone)} - {formatTime(meeting.endTime, user.timezone)}
                                  <span className="mx-2">•</span>
                                  {meeting.duration} min
                                  <span className="mx-2">•</span>
                                  {meeting.attendees?.length || 0} attendees
                                  <span className="mx-2">•</span>
                                  {meeting.meetingType === 'video_call' ? '🎥 Video' : '🏢 In-person'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
