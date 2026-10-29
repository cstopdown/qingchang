import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

type ExportResult = 'saved' | 'shared' | 'cancelled';

export async function subscribeAppPause(listener: () => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = await App.addListener('pause', listener);
  return () => { void handle.remove(); };
}

export interface LocalAiProgress {
  state: 'idle' | 'installing' | 'starting' | 'ready' | 'error';
  message: string;
}

declare global {
  interface Window {
    qingchangDesktop?: {
      platform: string;
      canStartLocalAi: boolean;
      exportAudio(bytes: Uint8Array, fileName: string): Promise<ExportResult>;
      openExternal(url: string): Promise<void>;
      startLocalAi(): Promise<void>;
      getLocalAiProgress(): Promise<LocalAiProgress>;
    };
  }
}

export function canStartLocalAi(): boolean {
  return window.qingchangDesktop?.canStartLocalAi === true;
}

export async function startLocalAi(): Promise<void> {
  if (!canStartLocalAi()) throw new Error('当前平台请连接已有私有 AI 服务。');
  await window.qingchangDesktop!.startLocalAi();
}

export async function getLocalAiProgress(): Promise<LocalAiProgress> {
  return window.qingchangDesktop
    ? window.qingchangDesktop.getLocalAiProgress()
    : { state: 'idle', message: '当前平台请连接已有私有 AI 服务。' };
}

export async function aiRequest(value: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const octets = host.split('.').map(Number);
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && octets.every(part => part <= 255);
  const privateHost = host === 'localhost' || host === '[::1]' || host.endsWith('.local') ||
    (ipv4 && (octets[0] === 127 || octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)));
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost)) || url.username || url.password) {
    throw new Error('AI 服务仅允许 HTTPS，或本机、私有局域网与 .local 地址的 HTTP。');
  }
  if (!Capacitor.isNativePlatform()) return fetch(url.href, { ...init, redirect: 'error' });

  init.signal?.throwIfAborted();
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new Error('AI 接口仅支持 GET 与 POST。');
  if (init.body && !(init.body instanceof FormData)) throw new Error('AI 音频请求必须使用 FormData。');
  const headers = new Headers(init.headers);
  const data = [];
  if (init.body instanceof FormData) {
    for (const [key, value] of init.body.entries()) {
      data.push(typeof value === 'string'
        ? { key, type: 'string', value }
        : { key, type: 'base64File', value: await blobBase64(value), fileName: value.name, contentType: value.type || 'application/octet-stream' });
    }
    headers.set('Content-Type', 'multipart/form-data');
  }
  init.signal?.throwIfAborted();
  const request = CapacitorHttp.request({
    url: url.href, method, headers: Object.fromEntries(headers), data,
    dataType: 'formData', responseType: 'json',
    connectTimeout: 10_000, readTimeout: 20 * 60_000, disableRedirects: true,
  }).then(result => new Response(typeof result.data === 'string' ? result.data : JSON.stringify(result.data), {
    status: result.status, headers: result.headers,
  }));
  if (!init.signal) return request;
  const signal = init.signal;
  // 原生请求发出后取消只中止界面等待；服务端已开始的推理仍可能完成。
  let abort: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([request, cancelled]); }
  finally { signal.removeEventListener('abort', abort!); }
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
