import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

function makePracticeAudio(seconds: number): Buffer {
  const sampleRate = 24000;
  const frames = sampleRate * seconds;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++)
    bytes.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 220 * frame) / sampleRate) * 3200),
      44 + frame * 2,
    );
  return bytes;
}

test("完成导入、收藏、真播放、跨页录音、回放导出与刷新持久化，并验收桌面手机布局", async ({
  page,
  context,
}) => {
  page.on("response", (response) => {
    if (response.status() >= 400)
      console.error("资源错误:", response.status(), response.url());
  });
  page.on("pageerror", (error) => console.error("页面错误:", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("浏览器错误:", message.text());
  });
  await context.grantPermissions(["microphone"]);
  await mkdir("artifacts", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".track-row")).toHaveCount(3);
  await page.screenshot({
    path: "artifacts/桌面-练唱曲库.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "开始我的第一首" }).click();
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "artifacts/桌面-录音工作室.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止测试", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "温暖", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "温暖", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("switch", { name: "耳机返听", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "耳机返听", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "返回曲库", exact: true }).click();
  await page.getByRole("button", { name: "开始我的第一首" }).click();
  await expect(
    page.getByRole("button", { name: "测试麦克风", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回曲库", exact: true }).click();
  await page
    .getByRole("button", { name: "导入歌曲", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "关闭弹窗", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "导入歌曲", exact: true })
    .last()
    .click();
  await dialog.locator(".file-drop input").setInputFiles({
    name: "我的练唱.wav",
    mimeType: "audio/wav",
    buffer: makePracticeAudio(8),
  });
  await dialog.getByRole("textbox", { name: "歌曲名称" }).fill("午后录音测试");
  await dialog.locator(".lyric-file input").setInputFiles({
    name: "午后.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "[00:00.00]风轻轻唱过午后\n[00:01.00]把声音留给自己\n[00:04.00]每一刻都值得记录",
    ),
  });
  await dialog.getByRole("button", { name: "加入我的曲库" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "搜索歌曲或歌手" })
    .fill("午后录音测试");
  const row = page.locator(".track-row").filter({ hasText: "午后录音测试" });
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "收藏 午后录音测试", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "取消收藏 午后录音测试", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await row
    .getByRole("button", { name: "播放 午后录音测试", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await page.locator(".player-time").innerText()).startsWith("0:01"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "进入工作室", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "风轻轻唱过午后", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.locator(".session-indicator")).toHaveText("正在录音", {
    timeout: 12000,
  });
  await expect(page.getByRole("slider", { name: "歌曲进度" })).toBeDisabled();
  await expect
    .poll(async () =>
      (await page.locator(".player-time").innerText()).startsWith("0:01"),
    )
    .toBe(true);
  // 切到手机并离开工作室，仍应能随时结束这遍录音。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await expect(page.locator(".recording-card")).toHaveCount(1);
  const playback = page.locator("audio");
  await playback.evaluate((audio: HTMLAudioElement) => audio.play());
  await expect
    .poll(() =>
      playback.evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await playback.evaluate((audio: HTMLAudioElement) => audio.pause());
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  expect(await download.failure()).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await expect(page.locator(".recording-card")).toHaveCount(1);
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "练唱曲库", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "取消收藏 午后录音测试", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/手机-练唱曲库.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "开始我的第一首" }).click();
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "artifacts/手机-录音工作室.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
