import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

type ExportResult = 'saved' | 'shared' | 'cancelled';

declare global {
  interface Window {
    qingchangDesktop?: {
      platform: string;
      exportAudio(bytes: Uint8Array, fileName: string): Promise<ExportResult>;
      openExternal(url: string): Promise<void>;
    };
  }
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportAudio(blob: Blob, fileName: string): Promise<ExportResult> {
  const clean = fileName.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[ .]+$/, '');
  const extension = clean.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '.wav';
  const stem = clean.endsWith(extension) ? clean.slice(0, -extension.length) : clean;
  const encoder = new TextEncoder();
  let title = '';
  for (const character of stem) {
    if (encoder.encode(title + character).byteLength > 200) break;
    title += character;
  }
  fileName = `轻唱-${title || '作品'}${extension}`;
  if (window.qingchangDesktop) {
    return window.qingchangDesktop.exportAudio(new Uint8Array(await blob.arrayBuffer()), fileName);
  }
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: `exports/${fileName}`,
      data: await blobBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    try {
      await Share.share({ title: '导出轻唱作品', files: [result.uri], dialogTitle: '保存或分享作品' });
    } catch (error) {
      if (error instanceof Error && error.message === 'Share canceled') return 'cancelled';
      throw error;
    }
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

export async function openExternal(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('只允许 HTTP 或 HTTPS 外链');
  if (window.qingchangDesktop) {
    await window.qingchangDesktop.openExternal(url.href);
  } else if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: url.href });
  } else {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
}

export function getPlatformLabel(): string {
  if (window.qingchangDesktop) return window.qingchangDesktop.platform === 'darwin' ? 'macOS' : 'Windows';
  const platform = Capacitor.getPlatform();
  return platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : '浏览器';
}
