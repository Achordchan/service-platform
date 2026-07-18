import express from "express";
import {
  createLaunchTicket,
  verifyWebhook,
} from "./achord-connect.js";

const app = express();
app.post("/achord/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  const valid = verifyWebhook({
    secret: process.env.ACHORD_WEBHOOK_SECRET,
    rawBody,
    eventId: req.header("X-Achord-Event-Id"),
    timestamp: req.header("X-Achord-Timestamp"),
    signature: req.header("X-Achord-Signature"),
  });
  if (!valid) return res.status(400).send("invalid signature");
  // 用 X-Achord-Event-Id 做数据库唯一键，重复事件直接返回 200。
  return res.sendStatus(200);
});

app.use(express.json());
app.post("/api/support/launch", async (req, res) => {
  const ticket = await createLaunchTicket({
    baseUrl: process.env.ACHORD_BASE_URL,
    clientId: process.env.ACHORD_CLIENT_ID,
    clientSecret: process.env.ACHORD_CLIENT_SECRET,
    user: {
      id: String(req.user.id),
      name: req.user.name,
      email: req.user.email,
    },
    context: { returnOrigin: process.env.APP_ORIGIN },
  });
  res.json(ticket);
});
