import {
  findPhoneNumbersInText,
  type CountryCode,
} from "libphonenumber-js";
import isEmail from "validator/lib/isEmail.js";

export type ContentRiskRuleResult = {
  blocked: boolean;
  candidate: boolean;
  categories: string[];
  normalizedText: string;
};

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const CONTACT_INTENT =
  /(?:加\s*(?:我|下|一下|好友|微|v)|私\s*聊|联\s*系|扫\s*(?:一下|码)|站\s*外|线\s*下|微\s*信|扣\s*扣|q\s*q|t\s*e\s*l\s*e\s*g\s*r\s*a\s*m|w\s*h\s*a\s*t\s*s\s*a\s*p\s*p)/i;
const SOCIAL_IDENTIFIER =
  /(?:(?:微信|微信号|WeChat|QQ|扣扣|Telegram|WhatsApp)\s*[:：是为]?\s*[a-z0-9_-]{4,}|\b(?:v\s*x|w\s*x|v\s*信)\s*[:：是为]?\s*[a-z0-9_-]{5,})/i;
const EXPLICIT_OFF_PLATFORM_GUIDANCE =
  /(?:加\s*(?:个|一下|我|好友)?\s*(?:微\s*信|v\s*信)|扫\s*(?:一下)?\s*(?:微信)?\s*码|去\s*(?:微信|QQ|扣扣|Telegram|WhatsApp)\s*(?:聊|联系))/i;
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s<>"',;，。；、）]+/gi;
const EMAIL_CANDIDATE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function normalizeRiskText(value: string) {
  return decodeBasicHtmlEntities(
    value.replace(
      /<[^>]*\b(?:href|src)\s*=\s*(["'])(.*?)\1[^>]*>/gi,
      " $2 ",
    ),
  )
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function evaluateContactRiskRules(
  text: string,
  options?: { defaultCountry?: string; allowedDomains?: string[] },
): ContentRiskRuleResult {
  const normalizedText = normalizeRiskText(text);
  const compact = normalizedText.replace(/[\s\-_.()（）]/g, "");
  const categories = new Set<string>();

  const phoneNumbers = findPhoneNumbersInText(normalizedText, {
    defaultCountry: (options?.defaultCountry ?? "CN") as CountryCode,
  });
  if (
    phoneNumbers.some(
      (item: { number: { isValid: () => boolean } }) => item.number.isValid(),
    )
  ) {
    categories.add("PHONE_NUMBER");
  } else if (/(?:\+?86)?1[3-9]\d{9}/.test(compact)) {
    categories.add("PHONE_NUMBER");
  }

  for (const match of normalizedText.matchAll(EMAIL_CANDIDATE)) {
    const email = match[0];
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    const allowed = options?.allowedDomains?.some(
      (item) => domain === item || domain.endsWith(`.${item}`),
    );
    if (!allowed && isEmail(email)) categories.add("EMAIL_ADDRESS");
  }

  if (SOCIAL_IDENTIFIER.test(normalizedText)) {
    categories.add("SOCIAL_ACCOUNT");
  }
  if (EXPLICIT_OFF_PLATFORM_GUIDANCE.test(normalizedText)) {
    categories.add("OFF_PLATFORM_GUIDANCE");
  }

  const candidate =
    categories.size > 0 ||
    CONTACT_INTENT.test(normalizedText) ||
    hasUnapprovedUrl(normalizedText, options?.allowedDomains ?? []) ||
    /\b\d(?:[\s\-_.]?\d){5,}\b/.test(normalizedText) ||
    /[零〇一二三四五六七八九幺壹贰叁肆伍陆柒捌玖](?:[\s\-_.]?[零〇一二三四五六七八九幺壹贰叁肆伍陆柒捌玖]){5,}/.test(
      normalizedText,
    );

  return {
    blocked: categories.size > 0,
    candidate,
    categories: [...categories],
    normalizedText,
  };
}

function decodeBasicHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    colon: ":",
    commat: "@",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : hex
          ? Number.parseInt(hex, 16)
          : null;
      if (codePoint !== null && Number.isSafeInteger(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return name ? named[name.toLowerCase()] ?? entity : entity;
    },
  );
}

function hasUnapprovedUrl(text: string, allowedDomains: string[]) {
  for (const match of text.matchAll(URL_LIKE)) {
    const raw = match[0].replace(/[),.;，。；）]+$/g, "");
    try {
      const url = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
      const hostname = url.hostname.toLowerCase();
      const allowed = allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
      if (!allowed) return true;
    } catch {
      return true;
    }
  }
  return false;
}
