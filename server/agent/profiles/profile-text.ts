/**
 * 渲染 profile prompt 用的缩进友好模板字符串。
 */
export function profileText(strings: TemplateStringsArray, ...values: unknown[]): string {
    const rawParts = strings.raw.map((part) => part.replace(/\r\n/g, "\n"));
    const firstPart = rawParts[0] ?? "";
    const lastIndex = rawParts.length - 1;
    rawParts[0] = firstPart.replace(/^\n/, "");
    rawParts[lastIndex] = (rawParts[lastIndex] ?? "").replace(/\n[ \t]*$/, "");

    const indent = minimumIndent(rawParts);
    return rawParts
        .map((part, index) => {
            const value = index < values.length ? String(values[index] ?? "") : "";
            return stripIndent(part, indent) + value;
        })
        .join("")
        .trim();
}

function minimumIndent(parts: readonly string[]): number {
    const indents = parts
        .flatMap((part) => part.split("\n"))
        .filter((line) => line.trim().length > 0)
        .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
    return indents.length > 0 ? Math.min(...indents) : 0;
}

function stripIndent(text: string, indent: number): string {
    if (indent <= 0) {
        return text;
    }
    return text
        .split("\n")
        .map((line) => line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line)
        .join("\n");
}
