import type { NextApiRequest, NextApiResponse } from 'next';

type Data = {
  url?: string;
  name?: string;
  token?: string;
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DAILY_API_KEY;
  const domain = process.env.DAILY_DOMAIN;

  if (!apiKey) {
    return res.status(500).json({
      error: 'DAILY_API_KEY not configured. Please add it to .env.local'
    });
  }

  if (!domain) {
    return res.status(500).json({
      error: 'DAILY_DOMAIN not configured. Please add it to .env.local'
    });
  }

  try {
    // Generate a random room name
    const roomName = `room-${Math.random().toString(36).substring(2, 9)}`;

    // Create the room via Daily API
    const response = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'public',
        properties: {
          enable_chat: true,
          enable_screenshare: true,
          enable_recording: 'cloud',
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({
        error: errorData.error || 'Failed to create room'
      });
    }

    const data = await response.json();

    // Create an owner token for this room
    const tokenResponse = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          is_owner: true,
          enable_recording: 'cloud',
        },
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Failed to create token:', errorData);
      // Still return the room, but without a token
      return res.status(200).json({
        url: data.url,
        name: data.name,
      });
    }

    const tokenData = await tokenResponse.json();

    return res.status(200).json({
      url: data.url,
      name: data.name,
      token: tokenData.token,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || 'An error occurred while creating the room'
    });
  }
}
