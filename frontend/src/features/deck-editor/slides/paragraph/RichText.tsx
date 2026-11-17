"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RichTextDoc, RichTextMark, RichTextNode } from "@/features/deck/types";
import { isSafeHref, normaliseBody, type TextAlign } from "./body";

// Renders a paragraph body (TipTap JSON) as React elements: never HTML
// strings, never dangerouslySetInnerHTML. The body is normalised first, so
// only the server's node / mark subset can render, and links are re-checked
// (http(s) / mailto only). Sizes are em-based so the caller's font-size
// (stage cqw or phone rem) scales everything. Colours come from --deck-*.

export interface RichTextProps {
	doc: RichTextDoc | null | undefined;
	/** Links are real anchors (new tab) only when interactive; the editor preview renders them as text. */
	interactive?: boolean;
	className?: string;
	style?: CSSProperties;
}

export function RichText({ doc, interactive = true, className, style }: RichTextProps) {
	const content = useMemo(() => normaliseBody(doc).content ?? [], [doc]);
	return (
		<div className={cn("[overflow-wrap:anywhere] [&>*+*]:mt-[0.6em]", className)} style={style}>
			{renderNodes(content, interactive)}
		</div>
	);
}

function renderNodes(nodes: RichTextNode[] | undefined, interactive: boolean): ReactNode[] {
	return (nodes ?? []).map((node, index) => renderNode(node, index, interactive));
}

function alignStyle(node: RichTextNode): CSSProperties | undefined {
	const align = node.attrs?.textAlign as TextAlign | undefined;
	return align ? { textAlign: align } : undefined;
}

const HEADING_SIZES: Record<number, string> = { 1: "1.6em", 2: "1.3em", 3: "1.12em" };

function renderNode(node: RichTextNode, key: number, interactive: boolean): ReactNode {
	switch (node.type) {
		case "paragraph":
			return (
				<p key={key} className="m-0 leading-[1.45]" style={alignStyle(node)}>
					{/* An empty paragraph keeps its line, as in the editor. */}
					{node.content?.length ? renderNodes(node.content, interactive) : <br />}
				</p>
			);
		case "heading": {
			const level = Number(node.attrs?.level ?? 1);
			// h1 is the slide title; body headings sit one level below it.
			const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
			return (
				<Tag key={key} className="m-0 font-bold leading-tight" style={{ fontSize: HEADING_SIZES[level] ?? "1.12em", ...alignStyle(node) }}>
					{node.content?.length ? renderNodes(node.content, interactive) : <br />}
				</Tag>
			);
		}
		case "blockquote":
			return (
				<blockquote
					key={key}
					className="m-0 border-l-[0.18em] pl-[0.8em] italic [&>*+*]:mt-[0.5em]"
					style={{ borderColor: "var(--deck-primary)", color: "var(--deck-text-muted)" }}
				>
					{renderNodes(node.content, interactive)}
				</blockquote>
			);
		case "bulletList":
			return (
				<ul key={key} className="m-0 list-disc pl-[1.35em] marker:text-[color:var(--deck-primary)] [&>li+li]:mt-[0.3em]">
					{renderNodes(node.content, interactive)}
				</ul>
			);
		case "orderedList":
			return (
				<ol
					key={key}
					start={typeof node.attrs?.start === "number" ? node.attrs.start : undefined}
					className="m-0 list-decimal pl-[1.6em] marker:font-semibold marker:text-[color:var(--deck-primary)] [&>li+li]:mt-[0.3em]"
				>
					{renderNodes(node.content, interactive)}
				</ol>
			);
		case "listItem":
			return (
				<li key={key} className="pl-[0.15em] [&>*+*]:mt-[0.3em]">
					{renderNodes(node.content, interactive)}
				</li>
			);
		case "codeBlock":
			return (
				<pre
					key={key}
					className="m-0 overflow-x-auto whitespace-pre-wrap rounded-[0.35em] px-[0.8em] py-[0.6em] font-mono text-[0.82em] leading-[1.5]"
					style={{ background: "var(--deck-surface-muted)", color: "var(--deck-text)" }}
				>
					<code>{(node.content ?? []).map((child) => child.text ?? "").join("")}</code>
				</pre>
			);
		case "horizontalRule":
			return <hr key={key} className="m-0 border-0 border-t-2" style={{ borderColor: "var(--deck-border)" }} />;
		case "hardBreak":
			return <br key={key} />;
		case "text":
			return <TextRun key={key} text={node.text ?? ""} marks={node.marks ?? []} interactive={interactive} />;
		default:
			return null;
	}
}

function TextRun({ text, marks, interactive }: { text: string; marks: RichTextMark[]; interactive: boolean }) {
	let out: ReactNode = text;
	let href: string | null = null;
	for (const mark of marks) {
		switch (mark.type) {
			case "bold":
				out = <strong className="font-bold">{out}</strong>;
				break;
			case "italic":
				out = <em>{out}</em>;
				break;
			case "underline":
				out = <u>{out}</u>;
				break;
			case "strike":
				out = <s>{out}</s>;
				break;
			case "code":
				out = (
					<code className="rounded-[0.25em] px-[0.3em] py-[0.05em] font-mono text-[0.88em]" style={{ background: "var(--deck-surface-muted)" }}>
						{out}
					</code>
				);
				break;
			case "link": {
				const candidate = mark.attrs?.href;
				href = isSafeHref(candidate) ? candidate : null;
				break;
			}
		}
	}
	if (!href) return <>{out}</>;
	// Text colour with a primary underline: primary-coloured text fails contrast on light themes.
	const linkClass = "underline decoration-[color:var(--deck-primary)] decoration-[0.08em] underline-offset-[0.15em]";
	return interactive ? (
		<a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cn(linkClass, "rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--deck-focus)]")}>
			{out}
		</a>
	) : (
		<span className={linkClass}>{out}</span>
	);
}
