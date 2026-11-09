import type { ReactNode } from "react";
import { LocalizedText } from "@/components/LocalizedText";
import { decodeRichTextEntities, sanitizeRichText } from "@/lib/rich-text";

type RichNode = { tag: string | null; children: Array<RichNode | string> };
const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"]);
const SAFE_TAG_TOKEN = /<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)|</gi;

function buildSafeTree(value: string): RichNode {
  const root: RichNode = { tag: null, children: [] };
  const stack = [root];
  const safeHtml = sanitizeRichText(value);

  for (const match of safeHtml.matchAll(SAFE_TAG_TOKEN)) {
    if (match[2] !== undefined || match[0] === "<") {
      const text = decodeRichTextEntities(match[2] ?? "<");
      if (text) stack[stack.length - 1].children.push(text);
      continue;
    }
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (match[0].startsWith("</")) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const node: RichNode = { tag, children: [] };
    stack[stack.length - 1].children.push(node);
    if (tag !== "br") stack.push(node);
  }
  return root;
}

function renderNode(node: RichNode, key: string): ReactNode {
  if (node.tag === null) return node.children.map((child, index) => renderChild(child, `${key}-${index}`));
  const children = node.children.map((child, index) => renderChild(child, `${key}-${index}`));
  return node.tag === "br" ? <br key={key} /> : <>{makeElement(node.tag, key, children)}</>;
}

function renderChild(child: RichNode | string, key: string): ReactNode {
  return typeof child === "string" ? <LocalizedText key={key}>{child}</LocalizedText> : renderNode(child, key);
}

function makeElement(tag: string, key: string, children: ReactNode[]) {
  switch (tag) {
    case "p": return <p key={key}>{children}</p>;
    case "strong": return <strong key={key}>{children}</strong>;
    case "b": return <b key={key}>{children}</b>;
    case "em": return <em key={key}>{children}</em>;
    case "i": return <i key={key}>{children}</i>;
    case "u": return <u key={key}>{children}</u>;
    case "ul": return <ul key={key}>{children}</ul>;
    case "ol": return <ol key={key}>{children}</ol>;
    case "li": return <li key={key}>{children}</li>;
    default: return <>{children}</>;
  }
}

export function RichText({ value, className }: { value: string; className?: string }) {
  const tree = buildSafeTree(value);
  return <div className={className} dir="auto">{tree.children.map((child, index) => renderChild(child, `rich-${index}`))}</div>;
}
