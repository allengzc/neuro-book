import {describe, expect, it} from "vitest";
import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";

describe("PlotFacade ProjectSession 守卫", () => {
    it("未 open 的 Project 拒绝创建 Plot Prisma client", async () => {
        const facade = new PlotFacade();

        await expect(facade.getStoryDto("workspace/not-open")).rejects.toBeInstanceOf(ProjectNotOpenError);
    });
});
