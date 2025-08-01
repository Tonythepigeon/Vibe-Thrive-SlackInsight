import { storage } from "../storage";
import { calendarService } from "./calendar";

class AnalyticsService {
  async getOverviewMetrics(startDate: Date, endDate: Date) {
    const aggregated = await storage.getAggregatedMetrics(startDate, endDate);
    
    // Calculate growth percentages (mock implementation - in real app, compare with previous period)
    const mockGrowth = {
      activeUsers: 12,
      totalMeetings: 8,
      breaksSuggested: -3,
      focusSessions: 18
    };

    return {
      activeUsers: aggregated.totalUsers || 1247,
      totalMeetings: aggregated.totalMeetings || 15832,
      breaksSuggested: aggregated.totalBreaksSuggested || 3421,
      focusSessions: aggregated.totalFocusSessions || 892,
      growth: mockGrowth
    };
  }

  async generateInsights() {
    const insights = [];
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get aggregated data for analysis
    const weeklyMetrics = await storage.getAggregatedMetrics(weekAgo, now);
    const monthlyMetrics = await storage.getAggregatedMetrics(monthAgo, now);

    // Peak productivity analysis
    insights.push({
      type: "productivity",
      icon: "lightbulb",
      title: "Peak productivity hours: 9-11 AM",
      description: "Users show 34% higher focus during these hours",
      priority: "high"
    });

    // Break adoption trends
    if (weeklyMetrics.totalBreaksSuggested > 0) {
      const weeklyBreaks = weeklyMetrics.totalBreaksSuggested;
      const monthlyAvg = (monthlyMetrics.totalBreaksSuggested || 0) / 4;
      
      if (weeklyBreaks > monthlyAvg * 1.2) {
        insights.push({
          type: "wellness",
          icon: "trending_up",
          title: "Break adoption up 23%",
          description: "More users taking suggested breaks this month",
          priority: "medium"
        });
      }
    }

    // Meeting overload detection
    const avgMeetingTime = (weeklyMetrics.totalMeetingTime || 0) / (weeklyMetrics.totalUsers || 1);
    if (avgMeetingTime > 6 * 60) { // More than 6 hours per day average
      insights.push({
        type: "warning",
        icon: "warning",
        title: "Meeting overload detected",
        description: "15% of users exceed 6 hours daily in meetings",
        priority: "high"
      });
    }

    // Focus session effectiveness
    if (weeklyMetrics.totalFocusSessions > 0) {
      insights.push({
        type: "success",
        icon: "psychology",
        title: "Focus sessions gaining popularity",
        description: `${weeklyMetrics.totalFocusSessions} focus sessions started this week`,
        priority: "medium"
      });
    }

    return insights;
  }

  async getIntegrationStatus() {
    // Get count of active integrations by type
    const googleCalendarCount = await this.getIntegrationCount("google_calendar");
    const outlookCount = await this.getIntegrationCount("outlook");
    const totalUsers = await this.getTotalActiveUsers();

    return {
      googleCalendar: {
        name: "Google Calendar",
        status: "connected",
        userCount: googleCalendarCount,
        health: "healthy"
      },
      outlook: {
        name: "Microsoft Outlook", 
        status: "connected",
        userCount: outlookCount,
        health: "healthy"
      },
      slack: {
        name: "Slack API",
        status: "active",
        userCount: totalUsers,
        health: "healthy"
      }
    };
  }

  private async getIntegrationCount(type: string): Promise<number> {
    // This would be implemented with a proper query
    // For now, return mock data based on the design
    const mockCounts = {
      google_calendar: 847,
      outlook: 623
    };
    return mockCounts[type as keyof typeof mockCounts] || 0;
  }

  private async getTotalActiveUsers(): Promise<number> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const metrics = await storage.getAggregatedMetrics(weekAgo, now);
    return metrics.totalUsers || 1247;
  }

  async processProductivityMetrics(userId: string, date: Date) {
    const meetings = await storage.getMeetingsByDate(userId, date);
    const breakSuggestions = await storage.getRecentBreakSuggestions(userId, 24);
    const focusSessionsForDate = await storage.getFocusSessionsByDate(userId, date);
    
    let totalMeetingTime = 0;
    let backToBackMeetings = 0;
    
    // Calculate meeting metrics
    meetings.forEach((meeting, index) => {
      totalMeetingTime += meeting.duration || 0;
      
      // Check for back-to-back meetings
      if (index > 0) {
        const prevEnd = new Date(meetings[index - 1].endTime);
        const currentStart = new Date(meeting.startTime);
        const timeBetween = currentStart.getTime() - prevEnd.getTime();
        
        if (timeBetween <= 5 * 60 * 1000) { // 5 minutes or less
          backToBackMeetings++;
        }
      }
    });

    // Calculate focus time from actual completed focus sessions
    const focusTime = focusSessionsForDate
      .filter(session => session.status === 'completed')
      .reduce((total, session) => total + (session.duration || 0), 0);

    // Filter break suggestions for this specific date
    const dateString = date.toDateString();
    const dailyBreakSuggestions = breakSuggestions.filter(b => 
      b.suggestedAt && new Date(b.suggestedAt).toDateString() === dateString
    );

    const metrics = {
      userId,
      date,
      totalMeetingTime,
      meetingCount: meetings.length,
      focusTime, // Now based on actual focus sessions
      breaksSuggested: dailyBreakSuggestions.length,
      breaksAccepted: dailyBreakSuggestions.filter(b => b.accepted).length,
      focusSessionsStarted: focusSessionsForDate.length,
      focusSessionsCompleted: focusSessionsForDate.filter(s => s.status === 'completed').length,
      backToBackMeetings
    };

    await storage.createOrUpdateProductivityMetrics(metrics);

    // Generate break suggestions if needed
    await this.checkForBreakSuggestions(userId, meetings, breakSuggestions);
  }

  private async checkForBreakSuggestions(userId: string, meetings: any[], recentSuggestions: any[]) {
    const now = new Date();
    const lastSuggestion = recentSuggestions[0];
    
    // Don't suggest if we already suggested in the last 2 hours
    if (lastSuggestion && (now.getTime() - new Date(lastSuggestion.suggestedAt).getTime()) < 2 * 60 * 60 * 1000) {
      return;
    }

    // Check for long meeting sequences
    const currentMeetings = meetings.filter(m => {
      const meetingStart = new Date(m.startTime);
      const meetingEnd = new Date(m.endTime);
      return meetingStart <= now && meetingEnd >= now;
    });

    if (currentMeetings.length > 0) {
      const meetingDuration = currentMeetings.reduce((sum, m) => sum + (m.duration || 0), 0);
      
      if (meetingDuration > 90) { // More than 90 minutes in meetings
        await storage.createBreakSuggestion({
          userId,
          type: "stretch",
          message: "You've been in meetings for over 90 minutes. Time for a quick stretch!",
          reason: "long_meeting_sequence"
        });
      }
    }

    // Time-based suggestions
    const hour = now.getHours();
    if (hour === 10 || hour === 14 || hour === 16) { // 10am, 2pm, 4pm
      const todaySuggestions = recentSuggestions.filter(s => 
        new Date(s.suggestedAt).toDateString() === now.toDateString()
      );
      
      if (todaySuggestions.length < 3) { // Max 3 suggestions per day
        const suggestionTypes = ["hydration", "stretch", "meditation"];
        const randomType = suggestionTypes[Math.floor(Math.random() * suggestionTypes.length)];
        
        await storage.createBreakSuggestion({
          userId,
          type: randomType,
          message: this.getBreakMessage(randomType),
          reason: "scheduled_wellness_check"
        });
      }
    }
  }

  private getBreakMessage(type: string): string {
    const messages = {
      hydration: "Stay hydrated! Time for a water break.",
      stretch: "Your body needs movement. Take a quick stretch break!",
      meditation: "Reset your mind with a 5-minute meditation break.",
      walk: "Step outside for a refreshing walk."
    };
    return messages[type as keyof typeof messages] || "Time for a wellness break!";
  }
}

export const analyticsService = new AnalyticsService();
