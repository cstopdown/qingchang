import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// 独立真实模型验收，不让日常 UI 回归依赖 6.2 GB 模型与推理服务。
test("真实 MiniCPM 完成器乐拒评及可选真人评分，报告刷新后保留", async ({
  page,
}) => {
  test.skip(
    process.env.QINGCHANG_REAL_AI !== "1",
    "需先启动真实 MiniCPM 服务，再显式开启此验收",
  );
  test.setTimeout(360000);
  await mkdir("artifacts", { recursive: true });
  await page.goto("/");
  await expect(page.locator(".track-row")).toHaveCount(3);
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page
    .getByRole("button", { name: "保存并检测连接", exact: true })
    .click();
  await expect(
    page.getByText("MiniCPM-o 4.5 已就绪，可以到「我的作品」开始评估。"),
  ).toBeVisible({ timeout: 15000 });
  await page
    .locator(".ai-service-card")
    .screenshot({ path: "artifacts/桌面-AI私有服务设置.png" });
  await page.evaluate(async () => {
    const path = "/src/data/library.ts";
    const { listTracks, saveRecording } = await import(/* @vite-ignore */ path);
    const [track] = await listTracks();
    await saveRecording({
      id: "real-ai-instrumental",
      trackId: track.id,
      trackTitle: track.title,
      title: "真实模型验收 · 原创器乐",
      createdAt: Date.now(),
      duration: track.duration,
      audio: track.audio,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  const scoreResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/score") &&
      response.request().method() === "POST",
    { timeout: 300000 },
  );
  await page
    .getByRole("button", { name: "AI 打分与练习建议", exact: true })
    .click();
  await expect(page.getByText("正在认真听这一遍…")).toBeVisible();
  const response = await scoreResponse;
  expect(response.status()).toBe(200);
  const report = await response.json();
  expect(report.recordingId).toBe("real-ai-instrumental");
  expect(report.inputKind).toBe("mixed");
  expect(report.scorable).toBe(false);
  expect(report.overall).toBeNull();
  expect(report.model).toContain("MiniCPM");
  await expect(page.getByText("暂不评分", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "查看练习建议与评估说明", exact: true })
    .click();
  await page
    .locator(".recording-card")
    .screenshot({ path: "artifacts/桌面-真实AI器乐拒评.png" });
  await writeFile(
    "artifacts/真实AI-器乐评估报告.json",
    JSON.stringify(report, null, 2),
  );
  await page.reload();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await expect(page.getByText("暂不评分", { exact: true })).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const path = "/src/data/library.ts";
    const { listRecordings } = await import(/* @vite-ignore */ path);
    const [recording] = await listRecordings();
    return recording.aiScore;
  });
  expect(persisted.id).toBe(report.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "查看练习建议与评估说明", exact: true })
    .click();
  await page
    .locator(".recording-card")
    .screenshot({ path: "artifacts/手机-真实AI器乐拒评.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  // 可选公开许可真人样本只提供音频输入；所有报告仍由实际服务推理。
  const fixturePath = process.env.QINGCHANG_REAL_AI_FIXTURE;
  if (!fixturePath) return;
  const fixture = await readFile(fixturePath);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async (encoded) => {
    const path = "/src/data/library.ts";
    const { saveRecording } = await import(/* @vite-ignore */ path);
    const bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    );
    const audio = new Blob([bytes], { type: "audio/wav" });
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    await context.close();
    await saveRecording({
      id: "real-ai-human",
      trackId: "vocalset-fixture",
      trackTitle: "VocalSet f1 dona · CC BY 4.0",
      title: "真实模型验收 · 真人清唱",
      createdAt: Date.now(),
      duration: decoded.duration,
      audio,
      vocalAudio: audio,
    });
  }, fixture.toString("base64"));
  await page.reload();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  const humanCard = page
    .locator(".recording-card")
    .filter({ hasText: "真实模型验收 · 真人清唱" });
  const humanResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/score") &&
      response.request().method() === "POST",
    { timeout: 300000 },
  );
  await humanCard
    .getByRole("button", { name: "AI 打分与练习建议", exact: true })
    .click();
  await expect(humanCard.getByText("正在认真听这一遍…")).toBeVisible();
  const responseHuman = await humanResponse;
  expect(responseHuman.status()).toBe(200);
  const humanReport = await responseHuman.json();
  expect(humanReport.recordingId).toBe("real-ai-human");
  expect(humanReport.inputKind).toBe("dry-vocal");
  expect(humanReport.scorable).toBe(true);
  expect(typeof humanReport.overall).toBe("number");
  await expect(
    humanCard.locator(".ai-score-overview:not(.unscorable)"),
  ).toBeVisible();
  await humanCard
    .getByRole("button", { name: "查看练习建议与评估说明", exact: true })
    .click();
  await humanCard.screenshot({ path: "artifacts/桌面-真实AI真人评分.png" });
  await writeFile(
    "artifacts/真实AI-真人清唱报告.json",
    JSON.stringify(humanReport, null, 2),
  );
  await page.reload();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await expect(
    humanCard.locator(".ai-score-overview:not(.unscorable)"),
  ).toBeVisible();
  const humanPersisted = await page.evaluate(async () => {
    const path = "/src/data/library.ts";
    const { listRecordings } = await import(/* @vite-ignore */ path);
    const recording = (await listRecordings()).find(
      (item: { id: string }) => item.id === "real-ai-human",
    );
    return recording.aiScore;
  });
  expect(humanPersisted.id).toBe(humanReport.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await humanCard
    .getByRole("button", { name: "查看练习建议与评估说明", exact: true })
    .click();
  await humanCard.screenshot({ path: "artifacts/手机-真实AI真人评分.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
