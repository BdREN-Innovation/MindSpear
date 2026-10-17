import type { RichTextDoc, RichTextMark, RichTextMarkType, RichTextNode, RichTextNodeType } from "@/features/deck/types";

// Client twin of ParagraphSlideType::validateBody() (backend). The paragraph
// body is TipTap / ProseMirror JSON; the server accepts only this node / mark
// subset, each only inside a parent that may hold it, keeps only known attrs
// and only http(s) / mailto links. We normalise the same way so that
//   - the editor sends exactly what the server will store (no echo churn),
//   - the renderers (presenter / phone) never see anything else, even from
//     an older or hand-made snapshot. Unlike the server we drop what is
//     invalid instead of rejecting the whole body.

export const MAX_BODY_TEXT = 5000;
export const MAX_BODY_NODES = 1000;
export const MAX_BODY_DEPTH = 10;
export const MAX_BODY_BYTES = 65536;
const MAX_HREF = 2048;

type BlockType = Extract<
	RichTextNodeType,
	"paragraph" | "heading" | "blockquote" | "bulletList" | "orderedList" | "codeBlock" | "horizontalRule"
>;

const BLOCKS: readonly BlockType[] = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule"];

/** Node type → node types it may contain (ParagraphSlideType::BODY_CHILDREN). */
const CHILDREN: Record<"doc" | RichTextNodeType, readonly RichTextNodeType[]> = {
	doc: BLOCKS,
	paragraph: ["text", "hardBreak"],
	heading: ["text", "hardBreak"],
	blockquote: BLOCKS,
	bulletList: ["listItem"],
	orderedList: ["listItem"],
	listItem: BLOCKS,
	codeBlock: ["text"],
	horizontalRule: [],
	hardBreak: [],
	text: [],
};

const MARKS: readonly RichTextMarkType[] = ["bold", "italic", "underline", "strike", "code", "link"];
const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
const HEADING_LEVELS = [1, 2, 3] as const;

export type TextAlign = (typeof TEXT_ALIGNS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ContentSlideType::clean(): CRLF/CR → LF, tab → space, line breaks → spaces
 * outside code blocks, and no C0/C1 controls or bidi overrides / isolates.
 */
export function cleanText(text: string, multiline: boolean): string {
	let value = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
	if (!multiline) value = value.replace(/\n/g, " ");
	return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "");
}

/** An http(s) URL with a host and no credentials, or a mailto: address (ParagraphSlideType::bodyHref). */
export function isSafeHref(href: unknown): href is string {
	if (typeof href !== "string" || href === "" || href.length > MAX_HREF) return false;
	// No whitespace, controls, separators or backslashes anywhere (parsers disagree about those).
	if (/[\p{C}\p{Z}\s\\]/u.test(href)) return false;
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return false;
	}
	switch (url.protocol) {
		case "http:":
		case "https:":
			return url.hostname !== "" && url.username === "" && url.password === "" && /^https?:\/\/[^/?#]/i.test(href);
		case "mailto:":
			return href.length > "mailto:".length;
		default:
			return false;
	}
}

function normaliseMarks(marks: unknown): RichTextMark[] {
	if (!Array.isArray(marks)) return [];
	const byType = new Map<RichTextMarkType, RichTextMark>();
	for (const mark of marks) {
		if (!isRecord(mark)) continue;
		const type = mark.type as RichTextMarkType;
		if (!MARKS.includes(type) || byType.has(type)) continue;
		if (type === "link") {
			const href = isRecord(mark.attrs) ? mark.attrs.href : undefined;
			// Only href survives (target / rel are the renderer's call); a bad link loses the mark, not the text.
			if (isSafeHref(href)) byType.set(type, { type, attrs: { href } });
			continue;
		}
		byType.set(type, { type });
	}
	return [...byType.values()];
}

function normaliseAttrs(type: RichTextNodeType, attrs: unknown): Record<string, unknown> {
	const input = isRecord(attrs) ? attrs : {};
	const out: Record<string, unknown> = {};
	if ((type === "paragraph" || type === "heading") && TEXT_ALIGNS.includes(input.textAlign as TextAlign)) {
		out.textAlign = input.textAlign;
	}
	if (type === "heading") {
		const level = input.level ?? 1;
		out.level = HEADING_LEVELS.includes(level as 1 | 2 | 3) ? level : 1;
	}
	if (type === "orderedList" && Number.isInteger(input.start) && (input.start as number) >= 0 && (input.start as number) <= 99999) {
		out.start = input.start;
	}
	if (type === "codeBlock" && typeof input.language === "string" && /^[A-Za-z0-9+#._-]{1,32}$/.test(input.language)) {
		out.language = input.language;
	}
	return out;
}

function normaliseNode(node: unknown, parent: "doc" | RichTextNodeType, depth: number): RichTextNode | null {
	if (!isRecord(node) || depth > MAX_BODY_DEPTH) return null;
	const type = node.type as RichTextNodeType;
	if (!CHILDREN[parent].includes(type)) return null;

	if (type === "text") {
		if (typeof node.text !== "string") return null;
		const text = cleanText(node.text, parent === "codeBlock");
		if (text === "") return null;
		const out: RichTextNode = { type: "text", text };
		// Code blocks take no marks in the schema.
		const marks = parent === "codeBlock" ? [] : normaliseMarks(node.marks);
		if (marks.length > 0) out.marks = marks;
		return out;
	}

	const out: RichTextNode = { type };
	const attrs = normaliseAttrs(type, node.attrs);
	if (Object.keys(attrs).length > 0) out.attrs = attrs;

	const content: RichTextNode[] = [];
	for (const child of Array.isArray(node.content) ? node.content : []) {
		const normalised = normaliseNode(child, type, depth + 1);
		if (normalised) content.push(normalised);
	}
	if (content.length > 0) out.content = content;
	// The server rejects empty lists; an empty list item has nothing to show either.
	else if (type === "bulletList" || type === "orderedList") return null;

	return out;
}

/** The body the server would store for `input` (an empty doc becomes one empty paragraph). */
export function normaliseBody(input: unknown): RichTextDoc {
	const content: RichTextNode[] = [];
	if (isRecord(input) && input.type === "doc" && Array.isArray(input.content)) {
		for (const child of input.content) {
			const normalised = normaliseNode(child, "doc", 1);
			if (normalised) content.push(normalised);
		}
	}
	return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** Key-order independent JSON, for "is this the same body?" checks. */
export function canonicalBody(doc: RichTextDoc | null | undefined): string {
	return JSON.stringify(doc ?? null, (_key, value: unknown) =>
		isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value
	);
}

export interface BodyStats {
	/** Characters (code points) across text nodes, as the server counts them. */
	chars: number;
	nodes: number;
	depth: number;
	bytes: number;
}

export function bodyStats(doc: RichTextDoc): BodyStats {
	let chars = 0;
	let nodes = 1;
	let depth = 0;
	const walk = (list: RichTextNode[] | undefined, level: number) => {
		for (const node of list ?? []) {
			nodes += 1;
			depth = Math.max(depth, level);
			if (node.text) chars += [...node.text].length;
			walk(node.content, level + 1);
		}
	};
	walk(doc.content, 1);
	return { chars, nodes, depth, bytes: new TextEncoder().encode(JSON.stringify(doc)).length };
}

/** Why `stats` cannot be saved, or null. */
export function bodyLimitProblem(stats: BodyStats): string | null {
	if (stats.chars > MAX_BODY_TEXT) {
		return `The text is longer than ${MAX_BODY_TEXT.toLocaleString("en")} characters, so it isn't saved. Shorten it to save.`;
	}
	if (stats.nodes > MAX_BODY_NODES || stats.depth > MAX_BODY_DEPTH || stats.bytes > MAX_BODY_BYTES) {
		return "The text has too many blocks or nested lists to save. Simplify it to save.";
	}
	return null;
}

/** True when the body has no text and no horizontal rule (nothing to show). */
export function isBodyEmpty(doc: RichTextDoc | null | undefined): boolean {
	const visit = (list: RichTextNode[] | undefined): boolean =>
		(list ?? []).every((node) => node.type !== "horizontalRule" && !node.text && visit(node.content));
	return !doc || visit(doc.content);
}
