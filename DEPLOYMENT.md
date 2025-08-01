# Render.com Deployment Guide

## Prerequisites

1. Push your code to a GitHub repository
2. Create accounts on:
   - [Render.com](https://render.com)
   - [Neon Database](https://neon.tech) (for PostgreSQL)

## Database Setup

### 1. Create Neon Database
1. Go to [Neon Console](https://console.neon.tech)
2. Create a new project named "slack-productivity-app"
3. Copy the connection string (it looks like: `postgresql://username:password@ep-xxx.region.neon.tech/dbname?sslmode=require`)

## Render.com Deployment

### 1. Create Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `slack-productivity-app`
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Starter` (free tier)

### 2. Environment Variables
Add these environment variables in Render:

#### Required Slack Variables
```
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret  
SLACK_SIGNING_SECRET=your_slack_signing_secret
```

#### Optional Slack Variables (add later if needed)
```
SLACK_BOT_TOKEN=your_bot_token
SLACK_CHANNEL_ID=your_channel_id
```

#### Database
```
DATABASE_URL=your_neon_postgresql_connection_string
```

#### System
```
NODE_ENV=production
PORT=5000
```

### 3. Deploy
1. Click "Create Web Service"
2. Render will automatically deploy your app
3. You'll get a URL like: `https://slack-productivity-app.onrender.com`

## Post-Deployment Configuration

### 1. Update Slack App Settings
Go to [api.slack.com/apps](https://api.slack.com/apps) and update:

#### OAuth & Permissions
- **Redirect URLs**: `https://your-app.onrender.com/api/slack/oauth`

#### Slash Commands
Create these commands:
- `/focus` → `https://your-app.onrender.com/api/slack/commands`
- `/break` → `https://your-app.onrender.com/api/slack/commands`
- `/summary` → `https://your-app.onrender.com/api/slack/commands`

#### Interactive Components
- **Request URL**: `https://your-app.onrender.com/api/slack/interactive`

#### Event Subscriptions
- **Request URL**: `https://your-app.onrender.com/api/slack/events`
- **Subscribe to**: `app_mention`, `message.im`

### 2. Database Migration
The app will automatically create database tables on first run using Drizzle's push functionality.

## Monitoring & Maintenance

### Logs
- View logs in Render Dashboard → Your Service → Logs
- Monitor for any startup errors or runtime issues

### Free Tier Limitations
- Render free tier sleeps after 15 minutes of inactivity
- For production use, consider upgrading to a paid plan for 24/7 availability

### Health Check
Your app provides a health endpoint at:
```
https://your-app.onrender.com/api/health
```

## Slack App Installation

Once deployed and configured:
1. Go to your Slack app settings → "Manage Distribution"
2. Install to your workspace via: `https://your-app.onrender.com/api/slack/install`
3. Test the slash commands and features

## Troubleshooting

### Common Issues
1. **Database Connection**: Ensure DATABASE_URL is correctly formatted
2. **Slack Verification**: Check SLACK_SIGNING_SECRET is correct
3. **OAuth Flow**: Verify redirect URLs match exactly
4. **Cold Starts**: Free tier apps may take 30+ seconds to wake up

### Environment Variables Check
You can verify your deployment at:
```
https://your-app.onrender.com/api/health
```

This should return a JSON response with status "ok".