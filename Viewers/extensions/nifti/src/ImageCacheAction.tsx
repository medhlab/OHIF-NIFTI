import React, { useEffect, useRef, useState } from 'react';
import { HardDrive, Loader2 } from 'lucide-react';
import { imageCacheStats, clearImageCache } from './frameDiskCache';
import { cancelCasePrefetch } from './casePrefetch';

export default function ImageCacheAction({ source, active }) {
  const [disk, setDisk] = useState<any>(null);
  const [clearing, setClearing] = useState(false), [message, setMessage] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, reading = false;
    const update = async () => {
      if (reading) return;
      reading = true;
      const stats = await imageCacheStats();
      if (!cancelled) setDisk(stats || { unavailable: true });
      reading = false;
    };
    void update();
    const timer = setInterval(update, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active]);
  const clear = async () => {
    if (pending.current) return;
    pending.current = true; setClearing(true); setMessage('');
    try {
      if (source) {
        source.prefetchSuppressed = true;
        source.prefetch = { ...(source.prefetch || { cases: [], bytes: 0, frames: 0 }), state: 'cancelled' };
        source.prefetchController?.abort();
      }
      cancelCasePrefetch();
      const cleared = await clearImageCache();
      const stats = await imageCacheStats();
      if (mounted.current) {
        setDisk(stats || { unavailable: true });
        setMessage(cleared ? '图像缓存已清理；当前图像和标注保留。刷新或打开病例后重新缓存。' : '清理失败：浏览器缓存不可用，请重试。');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setClearing(false);
    }
  };
  const usage = !disk ? '正在读取…' : disk.unavailable ? '缓存不可用'
    : `${Number((disk.bytes / 1024 ** 2).toFixed(1))} / ${disk.limit / 1024 ** 2} MiB`;
  return <section className="nt-image-cache" aria-label="本地图像缓存">
    <div className="nt-image-cache-row">
      <button type="button" disabled={clearing || !disk || disk.unavailable} onClick={clear}
        title="只清理本地 CT 图像缓存，保留当前图像和标注">
        {clearing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <HardDrive size={16} aria-hidden="true" />}
        {clearing ? '正在清理…' : '清理本地图像缓存'}
      </button>
      <span aria-label="本地图像缓存占用">{usage}</span>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
