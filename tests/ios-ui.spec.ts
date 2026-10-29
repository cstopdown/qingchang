import { expect, test, webkit } from "@playwright/test";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";

// 显式启用的桌面 WebKit 流程；安全区和键盘高度为浏览器模拟，不替代 iOS 真机。
test("WebKit 完成手机文件导入收藏与表单，检查安全区及 iPad 布局", async () => {
  test.skip(
    process.env.QINGCHANG_WEBKIT_UI !== "1",
    "需显式启用并安装官方 WebKit 运行时",
  );
  await mkdir(".tools", { recursive: true });
  const profile = await mkdtemp(`${process.cwd()}/.tools/webkit-ios-ui-`);
  const context = await webkit.launchPersistentContext(profile, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      console.error("WebKit页面错误", error.message),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error("WebKit控制台", message.text());
    });
    await mkdir("artifacts", { recursive: true });
    await page.goto("http://127.0.0.1:5173");
    await expect(page.locator(".track-row")).toHaveCount(3);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-top", "59px");
      document.documentElement.style.setProperty("--safe-bottom", "34px");
    });
    const header = await page.locator(".breadcrumb").boundingBox();
    expect(header!.y).toBeGreaterThanOrEqual(59);
    const navBounds = await page.locator(".mobile-nav").boundingBox();
    expect(navBounds!.height).toBe(102);
    const lastNav = await page
      .locator(".mobile-nav button")
      .last()
      .boundingBox();
    expect(lastNav!.y + lastNav!.height).toBeLessThanOrEqual(810);
    await page.getByRole("button", { name: "导入歌曲", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".file-drop input").setInputFiles({
      name: "iOS练唱.wav",
      mimeType: "audio/wav",
      buffer: await readFile("public/demos/evening.wav"),
    });
    await dialog.getByRole("textbox", { name: "歌曲名称" }).fill("iOS文件练唱");
    await dialog.locator(".lyric-file input").setInputFiles({
      name: "iOS练唱.lrc",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "[00:00.00]把声音留给自己\n[00:02.00]每一遍都值得听见",
      ),
    });
    await expect(dialog.getByRole("textbox", { name: "歌曲名称" })).toHaveCSS(
      "font-size",
      "16px",
    );
    // 缩小实际 WebKit 视口模拟键盘占位，验证弹窗内部可滚动提交。
    await page.setViewportSize({ width: 390, height: 480 });
    await dialog.locator("textarea").focus();
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.getBoundingClientRect().bottom),
      )
      .toBeLessThanOrEqual(446);
    await dialog
      .getByRole("button", { name: "加入我的曲库", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/iOS-WebKit-手机导入表单.png" });
    await dialog
      .getByRole("button", { name: "加入我的曲库", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("textbox", { name: "搜索歌曲或歌手" })
      .fill("iOS文件练唱");
    const row = page.locator(".track-row").filter({ hasText: "iOS文件练唱" });
    await expect(row).toHaveCount(1);
    await row
      .getByRole("button", { name: "收藏 iOS文件练唱", exact: true })
      .click();
    await page.reload();
    await expect(page.locator(".track-row")).toHaveCount(4);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-top", "59px");
      document.documentElement.style.setProperty("--safe-bottom", "34px");
    });
    await page
      .getByRole("textbox", { name: "搜索歌曲或歌手" })
      .fill("iOS文件练唱");
    await expect(
      row.getByRole("button", { name: "取消收藏 iOS文件练唱", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await row
      .getByRole("button", { name: "进入 iOS文件练唱 录音台", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "开始录音", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole("slider", { name: "歌曲进度" })
            .getAttribute("max"),
        ),
      )
      .toBeGreaterThan(1);
    await expect(
      page.getByRole("button", { name: "把声音留给自己", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".mini-play")).toHaveCSS("height", "44px");
    const player = await page.locator(".global-player").boundingBox();
    const nav = await page.locator(".mobile-nav").boundingBox();
    expect(player!.y + player!.height).toBeLessThanOrEqual(nav!.y);
    await page
      .locator(".studio-transport")
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: "artifacts/iOS-WebKit-手机工作室.png" });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "服务地址" })).toHaveCSS(
      "font-size",
      "16px",
    );
    await page
      .getByRole("textbox", { name: "服务地址" })
      .fill("http://192.168.1.20:8787");
    await page.locator(".ai-service-card").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/iOS-WebKit-手机AI设置.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty("--safe-top", "0px");
      style.setProperty("--safe-bottom", "21px");
      style.setProperty("--safe-left", "59px");
      style.setProperty("--safe-right", "59px");
    });
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await expect(page.locator(".mobile-nav")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1024, height: 1366 });
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty("--safe-top", "24px");
      style.setProperty("--safe-bottom", "20px");
      style.setProperty("--safe-left", "0px");
      style.setProperty("--safe-right", "0px");
    });
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "服务地址" })).toHaveCSS(
      "font-size",
      "16px",
    );
    await page.screenshot({ path: "artifacts/iOS-WebKit-iPad设置.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});
