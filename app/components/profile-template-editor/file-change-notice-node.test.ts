import {describe, expect, it} from "vitest";
import {generatePreviewNodeSource} from "nbook/app/components/profile-template-editor/profile-template-source-utils";
import {createNode} from "nbook/app/components/profile-template-editor/profile-template-tree-utils";

describe("FileChangeNotice visual node", () => {
    it("新节点默认使用 minimal 与 512 字符预算，并完整写回 TSX", () => {
        const node = createNode("FileChangeNotice");

        expect(node.props).toEqual({mode: "minimal", diffMaxChars: 512});
        expect(generatePreviewNodeSource(node)).toBe('<FileChangeNotice mode="minimal" diffMaxChars={512} />');
    });
});
