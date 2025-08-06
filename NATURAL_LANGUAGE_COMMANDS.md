# Natural Language Commands for SlackInsight

The AI service now supports natural language parsing for focus and break commands, allowing users to interact with the productivity assistant using conversational language instead of just slash commands.

## Focus Commands

### Start Focus Sessions
Users can now start focus sessions using natural language:

- `"start focus for 30 minutes"` → Starts a 30-minute focus session
- `"I need to concentrate for 45 minutes"` → Starts a 45-minute focus session  
- `"focus session for 2 hours"` → Starts a 120-minute focus session
- `"focus for 1.5 hours"` → Starts a 90-minute focus session
- `"I need to focus"` → Starts a 25-minute focus session (default)
- `"start a 90 minute focus session"` → Starts a 90-minute focus session
- `"can you start a focus session for 60 minutes"` → Starts a 60-minute focus session

### End Focus Sessions
Users can end focus sessions using natural language:

- `"end my focus session"` → Ends the current focus session
- `"stop focusing"` → Ends the current focus session
- `"I'm done focusing"` → Ends the current focus session

## Break Commands

### Start Breaks with Duration and Type
Users can start breaks with specific durations and types:

- `"I need a 15 minute break"` → Starts a 15-minute general break
- `"take a coffee break for 10 minutes"` → Starts a 10-minute coffee break
- `"I need to stretch for 5 minutes"` → Starts a 5-minute stretch break
- `"time for a 30 minute lunch break"` → Starts a 30-minute lunch break
- `"I need a break"` → Starts a 15-minute general break (default)
- `"hydration break for 3 minutes"` → Starts a 3-minute hydration break
- `"can I take a meditation break for 20 minutes"` → Starts a 20-minute meditation break
- `"I need to walk for 15 minutes"` → Starts a 15-minute walk break

## Supported Break Types

The AI recognizes these break types from natural language:

- **general** - General rest breaks
- **coffee** - Coffee/tea breaks (keywords: coffee, caffeine, tea)
- **hydration** - Water/hydration breaks (keywords: hydration, water, drink)
- **stretch** - Stretching/exercise breaks (keywords: stretch, stretching, exercise)
- **meditation** - Meditation/mindfulness breaks (keywords: meditation, meditate, mindfulness)
- **walk** - Walking breaks (keywords: walk, walking)
- **lunch** - Meal breaks (keywords: lunch, meal, food)

## Duration Parsing

The AI can parse various duration formats:

- `"30 minutes"` → 30 minutes
- `"2 hours"` → 120 minutes
- `"1.5 hours"` → 90 minutes
- `"45 min"` → 45 minutes
- `"90 minutes"` → 90 minutes
- `"25"` → 25 minutes (just a number)

## Usage Examples

### In Slack Channels
Users can mention the bot with natural language:

```
@SlackInsight start focus for 45 minutes
@SlackInsight I need a coffee break for 10 minutes
@SlackInsight end my focus session
@SlackInsight time for a 30 minute lunch break
```

### In Direct Messages
Users can send natural language commands directly:

```
start focus for 2 hours
I need to stretch for 5 minutes
take a meditation break for 20 minutes
stop focusing
```

## Fallback Parsing

If the AI doesn't correctly parse the duration or break type, the system includes fallback parsing:

1. **Duration Fallback**: Uses regex patterns to extract duration from text
2. **Break Type Fallback**: Maps keywords to break types
3. **Default Values**: Uses sensible defaults (25 min for focus, 15 min for breaks)

## Integration with Existing Commands

The natural language commands work alongside existing slash commands:

- `/focus 25` - Still works for direct command usage
- `/break 15 coffee` - Still works for direct command usage
- `/productivity` - Still works for productivity metrics

## Error Handling

The AI service includes robust error handling:

- Invalid durations are reset to defaults
- Unrecognized break types default to "general"
- Low confidence requests are marked as unsupported
- Fallback responses provide helpful guidance

## Technical Implementation

The natural language parsing is implemented in `server/services/ai.ts` with:

- Enhanced intent parsing with duration and break type extraction
- Utility methods for parsing durations and break types from text
- Validation and fallback mechanisms
- Integration with existing Slack command infrastructure

## Testing

You can test the natural language parsing using the test file:

```bash
cd server
npx ts-node test-ai.ts
```

This will test various natural language commands and show how they're parsed and executed. 