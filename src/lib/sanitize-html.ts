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

export function sanitizeMessageHtml(input: string) {
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

