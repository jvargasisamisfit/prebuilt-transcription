import type { NextApiRequest, NextApiResponse } from "next";

type MandyStateResponse =
  | {
      state: Record<string, unknown>;
    }
  | { error: string };

const serviceUrl = process.env.MANDY_SERVICE_URL;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MandyStateResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!serviceUrl) {
    return res.status(500).json({
      error: "MANDY_SERVICE_URL is not configured on the server.",
    });
  }

  const { domain, room, ...rest } = req.body ?? {};

  if (!domain || !room) {
    return res.status(400).json({
      error: "Both domain and room are required to control Mandy.",
    });
  }

  try {
    const response = await fetch(
      `${serviceUrl.replace(/\/$/, "")}/api/control`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain,
          room,
          ...rest,
        }),
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      const message =
        typeof payload?.detail === "string"
          ? payload.detail
          : payload?.error || "Failed to update Mandy.";
      return res.status(response.status).json({ error: message });
    }

    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || "Unexpected error reaching Mandy service.",
    });
  }
}
