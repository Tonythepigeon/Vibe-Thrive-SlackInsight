# Intelligent Scheduling Feature

## Overview

The AI assistant now includes an intelligent scheduling capability that uses LLM (Large Language Model) analysis to provide smart, context-aware scheduling suggestions for breaks, walks, and other activities.

## Key Features

### 🧠 LLM-Powered Analysis
- **Context Awareness**: Analyzes meeting titles, types, and attendee counts to understand meeting importance
- **Energy Management**: Considers natural energy cycles and meeting intensity
- **Activity-Specific Timing**: Provides optimal timing based on activity type (walks, lunch, coffee, etc.)
- **Confidence Scoring**: Each time slot comes with a confidence score (0.1-1.0)

### 📅 Smart Scheduling Criteria

#### Activity-Specific Timing
- **Walks**: Best in daylight hours (10 AM - 4 PM), avoid right before important meetings
- **Lunch**: Traditional lunch hours (11:30 AM - 1:30 PM)
- **Coffee Breaks**: Mid-morning (10-11 AM) or mid-afternoon (2-4 PM)
- **Stretching**: After long meetings or before important ones
- **Meditation**: Quiet times, avoid rush hours

#### Meeting Context Analysis
- **High-stakes meetings**: Suggests breaks before for preparation time
- **Back-to-back meetings**: Recommends buffer time between meetings
- **Meeting intensity**: Considers meeting duration and attendee count
- **Natural break patterns**: Identifies optimal break points in the schedule

#### Time Preferences
- **Morning**: Before 12 PM
- **Afternoon**: After 12 PM
- **Anytime**: No preference, considers all factors

## Usage Examples

### Basic Scheduling Requests
```
"My day looks super packed but I really want to go for a 15 minute walk, when is ideal?"
"When can I take a 10 minute coffee break?"
"Suggest a good time for lunch"
```

### Time-Specific Requests
```
"I want to take a 20 minute break in the morning"
"Find me time for a 30 minute break this afternoon"
```

### Activity-Specific Requests
```
"I need a 15 minute stretch break"
"Looking for time for a meditation session"
```

## Response Format

The AI provides comprehensive scheduling analysis including:

### Time Slots
- **Start/End Times**: Specific timing for each slot
- **Description**: Context about the slot (e.g., "Between Team Standup and Client Meeting")
- **Confidence Score**: How optimal this slot is (0-100%)
- **Reasoning**: Why this slot is recommended

### Schedule Insights
- **Meeting Patterns**: Analysis of your meeting schedule
- **Energy Management**: Suggestions for optimal timing
- **Productivity Tips**: Recommendations for better scheduling

### Example Response
```
I found 2 optimal slots for your 15-minute walk:

1. 9:30 AM - Between Team Standup and Client Meeting (Confidence: 95%)
   Reasoning: Natural break point, 15-minute gap, good for fresh air before important client call

2. 3:00 PM - After Project Review Meeting (Confidence: 85%)
   Reasoning: After a long 60-minute meeting, perfect for stretching and refresh

Schedule Insights:
• You have a busy morning with back-to-back meetings
• Good opportunity for a walk before your client meeting at 11:00 AM
• Consider a longer lunch break after your project review
```

## Technical Implementation

### LLM Integration
- Uses Gemini 1.5 Flash for intelligent analysis
- Structured JSON responses for consistent parsing
- Fallback to algorithmic approach if LLM fails

### Data Sources
- **Meeting Data**: Title, duration, attendees, type, timing
- **User Preferences**: Time zone, activity preferences
- **Context**: Current time, work hours, activity type

### Analysis Pipeline
1. **Intent Parsing**: Understands user request and extracts parameters
2. **Data Gathering**: Retrieves user's meeting schedule
3. **LLM Analysis**: Sends formatted data to LLM for intelligent analysis
4. **Response Generation**: Creates user-friendly response with insights
5. **Fallback Handling**: Uses algorithmic approach if LLM fails

## Benefits

### For Users
- **Smarter Suggestions**: Context-aware timing recommendations
- **Better Energy Management**: Considers natural energy cycles
- **Improved Productivity**: Optimal break timing for peak performance
- **Personalized Insights**: Schedule analysis and recommendations

### For Organizations
- **Better Work-Life Balance**: Encourages healthy break patterns
- **Improved Focus**: Optimal timing for deep work and breaks
- **Reduced Burnout**: Intelligent scheduling prevents overwork
- **Enhanced Productivity**: Data-driven scheduling insights

## Testing

Use the test script to verify functionality:
```bash
npx tsx server/test-intelligent-scheduling.ts
```

This will test various scheduling scenarios with realistic meeting data.

## Future Enhancements

- **Weather Integration**: Consider weather for outdoor activities
- **Historical Patterns**: Learn from user's past scheduling preferences
- **Team Coordination**: Consider team members' schedules
- **Calendar Integration**: Direct calendar booking capabilities
- **Health Metrics**: Integrate with wellness tracking data 