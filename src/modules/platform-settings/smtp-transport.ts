import "server-only";

import { isIP } from "node:net";
import nodemailer from "nodemailer";

export type SmtpTransportSettings = {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
};

export function createSmtpTransport(settings: SmtpTransportSettings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    requireTLS: !settings.smtpSecure,
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPassword,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: {
      minVersion: "TLSv1.2",
      servername: isIP(settings.smtpHost) ? undefined : settings.smtpHost,
    },
  });
}
