# AI Service Integration

This service integrates Gemini 1.5 Flash with Slack to provide intelligent natural language processing for productivity commands.

## Features

- **Natural Language Understanding**: Interprets user requests in plain English
- **Command Execution**: Automatically executes appropriate Slack commands (`/focus`, `/break`, `/productivity`)
- **Intelligent Recommendations**: Provides personalized productivity tips based on user data
- **Graceful Fallbacks**: Falls back to simple responses when AI is unavailable

## Setup

### 1. Environment Variables

Add the following to your `.env` file:

```bash
# Google AI API Key for Gemini 1.5 Flash
GOOGLE_API_KEY=your_google_api_key_here
```

### 2. Get Google AI API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Copy the key and add it to your environment variables

### 3. Usage Examples

#### Direct Messages (Primary Interface)
Users can send direct messages to the bot with natural language:

- `start a 30 minute focus session`
- `I need a coffee break`
- `how productive was I today?`
- `suggest a stretch break`
- `help me focus for the next hour`

#### Slack App Mentions
Users can mention the bot in channels with natural language:

- `@ProductivityBot start a 30 minute focus session`
- `@ProductivityBot I need a coffee break`
- `@ProductivityBot how productive was I today?`
- `@ProductivityBot suggest a stretch break`

#### Enhanced Slash Commands
Slash commands now support natural language input:

- `/focus please start a 45 minute session` (uses AI)
- `/focus 25` (traditional mode)
- `/break I'm feeling tired` (uses AI)
- `/break hydration` (traditional mode)
- `/productivity show me this week's summary` (uses AI)

#### Interactive Buttons
The bot provides interactive buttons for quick actions:
- Focus session buttons (25min, 45min)
- Break suggestion buttons (coffee, stretch)
- Productivity summary button

#### API Endpoints (For Development/Testing)

**Chat Endpoint**: `POST /api/ai/chat`
```json
{
  "message": "start a focus session for 25 minutes",
  "userId": "user123",
  "teamId": "team456"
}
```

**Health Check**: `GET /api/ai/health`
```json
{
  "healthy": true,
  "status": "AI service is operational",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

> **Note**: The primary interface is through Slack interactions. API endpoints are mainly for development and testing purposes.

## Architecture

### Slack Integration
- **Direct Messages**: Primary interface for natural language interactions
- **App Mentions**: Channel-based interactions with AI processing
- **Enhanced Slash Commands**: Natural language support for traditional commands
- **Interactive Buttons**: Quick action buttons for common tasks
- **Graceful Fallbacks**: Falls back to simple responses when AI is unavailable

### LangChain Integration
- Uses LangChain for orchestration and prompt management
- Implements structured output parsing for reliable command mapping
- Supports chain-of-thought reasoning for complex requests

### Command Mapping
The AI service maps natural language to structured commands:

1. **Focus Commands**
   - "start a focus session" → `/focus 25`
   - "concentrate for 45 minutes" → `/focus 45`
   - "end my focus session" → `/focus end`
   - "I need to focus" → `/focus 25`
   - "help me concentrate" → `/focus 30`

2. **Break Commands**
   - "I need a break" → `/break general`
   - "coffee time" → `/break hydration`
   - "stretch break" → `/break stretch`
   - "I'm tired" → `/break general`
   - "time for a walk" → `/break walk`

3. **Productivity Commands**
   - "show my metrics" → `/productivity`
   - "how was my day?" → `/productivity`
   - "meeting summary" → `/productivity`
   - "productivity report" → `/productivity`
   - "how productive was I?" → `/productivity`

### Interactive Features
- **Quick Buttons**: One-click actions for common tasks
- **Contextual Responses**: AI provides personalized recommendations
- **Status Integration**: Automatic Slack status updates during focus sessions
- **Meeting Awareness**: Break suggestions consider calendar conflicts

### Intelligent Recommendations
The service analyzes user data to provide personalized recommendations:

- **Focus Sessions**: Pomodoro technique tips, distraction management
- **Break Suggestions**: Movement, hydration, mindfulness practices
- **Productivity Insights**: Meeting optimization, time blocking strategies

## Error Handling

### Graceful Degradation
- If AI service is unavailable, falls back to keyword-based responses
- Provides helpful error messages for users
- Logs errors for debugging while maintaining user experience

### Unsupported Queries
- Politely responds "Sorry, I cannot answer that" for non-productivity requests
- Suggests appropriate productivity-related alternatives
- Maintains focus on core productivity features

## Monitoring

### Health Checks
- Continuous monitoring of AI service availability
- Automatic fallback to simple responses when needed
- Health status exposed via API endpoint

### Logging
- Comprehensive logging of AI interactions
- Error tracking and debugging information
- Performance metrics for optimization

## Development

### Testing the AI Service

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Test the health endpoint**:
   ```bash
   curl http://localhost:5000/api/ai/health
   ```

3. **Test chat functionality**:
   ```bash
   curl -X POST http://localhost:5000/api/ai/chat \
     -H "Content-Type: application/json" \
     -d '{
       "message": "start a 30 minute focus session",
       "userId": "test_user",
       "teamId": "test_team"
     }'
   ```

### Testing Slack Integration

1. **Direct Messages**: Send a DM to the bot with natural language
2. **App Mentions**: Mention the bot in a channel
3. **Slash Commands**: Try enhanced commands with natural language
4. **Interactive Buttons**: Click buttons in bot responses

### Test Scenarios

- **Focus Sessions**: "start a 25 minute focus session"
- **Break Requests**: "I need a coffee break"
- **Productivity Queries**: "how productive was I today?"
- **Help Requests**: "what can you help me with?"

### Extending the Service

To add new command types:

1. Update the `CommandIntent` interface in `ai.ts`
2. Add new command mapping logic in `parseIntent()`
3. Implement command execution in `executeCommand()`
4. Add recommendation logic in `generateRecommendations()`

## Security Considerations

- API keys are stored securely in environment variables
- User data is processed according to privacy guidelines
- No sensitive information is sent to external AI services
- All interactions are logged for audit purposes

## Performance

- Average response time: <2 seconds
- Supports concurrent requests
- Automatic timeout handling (10 seconds)
- Efficient caching of AI model instances