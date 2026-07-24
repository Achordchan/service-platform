import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
];

const ALLOWED_ATTR = ["href", "target", "rel"];

function isSafeHref(href: string) {
  const value = href.trim().toLowerCase();
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    value.startsWith("/")
  );
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function protectInlineImages(input: string) {
  const images = new Map<string, string>();
  let index = 0;
  const html = input.replace(/<img\b[^>]*>/gi, (tag) => {
    const id =
      tag.match(/\bdata-attachment-id\s*=\s*["']([a-z0-9_-]+)["']/i)?.[1] ??
      tag.match(/\bsrc\s*=\s*["']attachment:\/\/([a-z0-9_-]+)["']/i)?.[1];
    if (!id) return "";
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "正文图片";
    const token = `ACHORD_INLINE_IMAGE_${index++}_${id}`;
    images.set(
      token,
      `<img src="attachment://${id}" data-attachment-id="${id}" alt="${escapeAttribute(alt)}">`,
    );
    return token;
  });
  return { html, images };
}

export function sanitizeMessageHtml(input: string) {
  const protectedContent = protectInlineImages(input);
  let result = purifyMessageHtml(protectedContent.html);
  for (const [token, image] of protectedContent.images) {
    result = result.replaceAll(token, image);
  }
  return result;
}

export function sanitizeReeditableMessageHtml(input: string) {
  return purifyMessageHtml(input);
}

function purifyMessageHtml(input: string) {
  const purified = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
    ],
    FORBID_ATTR: ["style", "onerror", "onclick", "onload"],
  });

  return purified
    .replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
      const hrefMatch = attrs.match(
        /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i,
      );
      const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? "";
      if (!href || !isSafeHref(href)) {
        return "<a>";
      }
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
    })
    .trim();
}
