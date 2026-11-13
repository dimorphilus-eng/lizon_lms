import sanitizeHtml from "sanitize-html";

export function cleanHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span", "u"]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
