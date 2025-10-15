# Setup Instructions

## Quick Start

1. **Add your Daily API key to `.env.local`:**

   Open `.env.local` and replace `your_daily_api_key_here` with your actual Daily API key.

   You can get your API key from: https://dashboard.daily.co/developers

2. **The app is now running at:** http://localhost:3001

## How to Use

1. Go to http://localhost:3001
2. Enter your name (it will be saved for future sessions)
3. Click "Create Room" - a new room will be automatically generated
4. Share the generated link with others to join your room
5. Click "Join" to enter the room yourself

## Features

- **Automatic room creation** - No need to manually create rooms in the Daily dashboard
- **Name persistence** - Your name is stored in localStorage
- **Live transcription** - When enabled on your Daily domain
- **Shareable links** - Easy to share room links with others

## Transcription Setup (Optional)

To enable transcription, you need to configure your Daily domain with Deepgram:

```bash
curl --request POST \
     --url https://api.daily.co/v1/ \
     --header 'Accept: application/json' \
     --header 'Authorization: Bearer YOUR_DAILY_API_KEY' \
     --header 'Content-Type: application/json' \
     --data '{"properties": { "enable_transcription": "deepgram:YOUR_DEEPGRAM_API_KEY" }}'
```

Get your Deepgram API key from: https://console.deepgram.com/
