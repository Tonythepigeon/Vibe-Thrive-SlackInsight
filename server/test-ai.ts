import { aiService } from './services/ai';

async function testAIService() {
  console.log('Testing AI Service Intent Parsing...\n');

  const testCases = [
    "give me a 5 minute break",
    "I need a 10 minute coffee break", 
    "start focus for 30 minutes",
    "end my focus session",
    "take a 15 minute stretch break",
    "focus for 45 minutes",
    "I need a break",
    "start a meditation break for 20 minutes"
  ];

  for (const testCase of testCases) {
    console.log(`Testing: "${testCase}"`);
    try {
      const response = await aiService.processUserMessage(testCase, 'test-user', 'test-team');
      console.log(`Intent: ${response.commandResult?.command || 'none'}`);
      console.log(`Action: ${response.commandResult?.action || 'none'}`);
      console.log(`Duration: ${response.commandResult?.duration || 'none'}`);
      console.log(`Break Type: ${response.commandResult?.breakType || 'none'}`);
      console.log(`Executed: ${response.executed}`);
      console.log(`Message: ${response.message.substring(0, 100)}...`);
      console.log('---\n');
    } catch (error) {
      console.error(`Error testing "${testCase}":`, error);
      console.log('---\n');
    }
  }
}

// Run the test
testAIService().catch(console.error); 