/**
 * IG Video Progressbar
 * Injects a YouTube-style seekable progress bar onto Instagram videos.
 */

(function () {
  'use strict';

  // Avoid double injection
  if (window.__igpbLoaded) return;
  window.__igpbLoaded = true;

  const ATTR = 'data-igpb';

  // ── Helpers ──────────────────────────────────────────────────────────────

  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  // ── Sync Instagram's native mute button UI ──────────────────────────────

  function syncNativeMuteButton(video, attempt) {
    attempt = attempt || 0;
    if (attempt > 8) return;

    // Instagram 的靜音按鈕可能不在 video 的祖先中（因為我們已把 video 移入 wrapper）
    // 改用全局搜索，再以位置過濾確認是同一播放器內的按鈕
    const videoRect = video.getBoundingClientRect();

    // 搜尋所有按鈕（有無 aria-label 皆包含）
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      // 覆蓋多語言：英文 "Unmute"、繁中 "取消靜音"、簡中 "取消静音"
      const isMutedBtn = label.includes('unmute') ||
                         label.includes('取消靜音') ||
                         label.includes('取消静音');
      if (!isMutedBtn) continue;

      // 確認按鈕在 video 可視區域附近（500px 範圍內）
      const btnRect = btn.getBoundingClientRect();
      const near = Math.abs(btnRect.top - videoRect.top) < 500 &&
                   Math.abs(btnRect.left - videoRect.left) < 500;
      if (!near) continue;

      // 使用完整 pointer + mouse 事件序列，讓 React 的事件代理能正確觸發
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
      // 點擊後確保音量維持在 100%
      setTimeout(() => {
        video.muted = false;
        video.removeAttribute('muted');
        video.volume = 1;
      }, 50);
      return;
    }

    // 尚未找到按鈕，200ms 後重試（Instagram 的 React UI 可能還未渲染）
    setTimeout(() => syncNativeMuteButton(video, attempt + 1), 200);
  }

  // ── Build the volume bar DOM ─────────────────────────────────────────────

  function buildVolumeBar(video) {
    const wrap = document.createElement('div');
    wrap.className = 'igpb-volume-wrap';

    const pill = document.createElement('div');
    pill.className = 'igpb-volume-pill';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'igpb-volume-slider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.02';

    function syncUI() {
      const vol = video.muted ? 0 : video.volume;
      slider.value = vol;
      const pct = vol * 100;
      slider.style.background = `linear-gradient(to right, rgba(255,255,255,0.9) ${pct}%, rgba(255,255,255,0.3) ${pct}%)`;
    }

    syncUI();

    slider.addEventListener('input', (e) => {
      e.stopPropagation();
      const vol = parseFloat(slider.value);
      video.volume = vol;
      video.muted = vol === 0;
      if (vol > 0) video.removeAttribute('muted');
      syncUI();
    });

    // 防止滑桿操作觸發 IG 的點擊事件
    slider.addEventListener('click', (e) => e.stopPropagation());
    slider.addEventListener('mousedown', (e) => e.stopPropagation());

    // 同步 Instagram 原生靜音按鈕的狀態變化
    video.addEventListener('volumechange', syncUI);

    pill.appendChild(slider);
    wrap.appendChild(pill);

    return wrap;
  }

  // ── Build fullscreen button ──────────────────────────────────────────────

  function buildFullscreenButton(video, wrapper) {
    const btn = document.createElement('button');
    btn.className = 'igpb-fs-btn';
    btn.setAttribute('aria-label', 'Fullscreen');

    const svgEnter = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
    </svg>`;
    const svgExit = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
    </svg>`;

    function syncIcon() {
      btn.innerHTML = document.fullscreenElement ? svgExit : svgEnter;
    }
    syncIcon();
    document.addEventListener('fullscreenchange', syncIcon);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        wrapper.requestFullscreen().catch(() => {});
      }
    });

    return btn;
  }

  // ── Build the progress bar DOM ───────────────────────────────────────────

  function buildProgressBar(video) {
    // gradient fade (visual only, pointer-events: none)
    const gradient = document.createElement('div');
    gradient.className = 'igpb-gradient';

    // track (clickable area)
    const track = document.createElement('div');
    track.className = 'igpb-bar-track';

    const buffered = document.createElement('div');
    buffered.className = 'igpb-buffered';

    const progress = document.createElement('div');
    progress.className = 'igpb-progress';

    const thumb = document.createElement('div');
    thumb.className = 'igpb-thumb';

    const tooltip = document.createElement('div');
    tooltip.className = 'igpb-tooltip';
    tooltip.textContent = '0:00';

    track.appendChild(buffered);
    track.appendChild(progress);
    track.appendChild(thumb);
    track.appendChild(tooltip);

    const container = document.createElement('div');
    container.className = 'igpb-container';
    container.appendChild(track);

    return { container, track, buffered, progress, thumb, tooltip, gradient };
  }

  // ── Attach to a single video element ────────────────────────────────────

  function attachProgressBar(video) {
    if (video.hasAttribute(ATTR)) return;
    video.setAttribute(ATTR, '1');

    const parent = video.parentElement;
    if (!parent) return;

    // 建立 wrapper 包裹 video 和所有控制元件
    const wrapper = document.createElement('div');
    wrapper.className = 'igpb-wrapper';
    parent.insertBefore(wrapper, video);
    wrapper.appendChild(video);

    // 強制取消靜音並設定音量為 100%
    // 注意：只在此處（用戶手勢的呼叫鏈中）設定，不在 play 事件中設定。
    // 在 play 事件（自動播放）中呼叫 unmute 會觸發瀏覽器 Autoplay Policy，
    // 導致瀏覽器拒絕並直接將影片暫停。
    video.muted = false;
    video.removeAttribute('muted');
    video.volume = 1;
    setTimeout(() => syncNativeMuteButton(video), 300);

    const { container, track, buffered, progress, thumb, tooltip, gradient } =
      buildProgressBar(video);

    const volumeBar = buildVolumeBar(video);
    const fsBtn = buildFullscreenButton(video, wrapper);

    wrapper.appendChild(gradient);
    wrapper.appendChild(container);
    wrapper.appendChild(volumeBar);
    wrapper.appendChild(fsBtn);

    // 用 mousemove 檢查滑鼠座標是否在影片範圍內
    // （Instagram 的 overlay 會攔截事件，mouseenter/CSS hover 均失效）
    let controlsVisible = false;
    function updateControlsVisibility(e) {
      const rect = video.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside === controlsVisible) return;
      controlsVisible = inside;
      volumeBar.classList.toggle('igpb-volume-show', inside);
      fsBtn.classList.toggle('igpb-fs-show', inside);
    }
    document.addEventListener('mousemove', updateControlsVisibility);

    // ── Update UI from video state ─────────────────────────────────────

    function updateProgress() {
      const duration = video.duration;
      if (!duration || !isFinite(duration)) return;

      const pct = (video.currentTime / duration) * 100;
      progress.style.width = `${pct}%`;
      thumb.style.left = `${pct}%`;

      // buffered
      if (video.buffered.length > 0) {
        const bufPct =
          (video.buffered.end(video.buffered.length - 1) / duration) * 100;
        buffered.style.width = `${bufPct}%`;
      }
    }

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('progress', updateProgress);
    video.addEventListener('loadedmetadata', updateProgress);

    // ── Seek logic ────────────────────────────────────────────────────

    function getSeekFraction(clientX) {
      const rect = track.getBoundingClientRect();
      return clamp((clientX - rect.left) / rect.width, 0, 1);
    }

    function seekTo(fraction) {
      const duration = video.duration;
      if (!duration || !isFinite(duration)) return;
      video.currentTime = fraction * duration;

      // Update thumb + progress immediately (don't wait for timeupdate)
      const pct = fraction * 100;
      progress.style.width = `${pct}%`;
      thumb.style.left = `${pct}%`;
      tooltip.textContent = formatTime(fraction * duration);
      tooltip.style.left = `${pct}%`;
    }

    function updateTooltip(fraction) {
      const duration = video.duration;
      if (!duration || !isFinite(duration)) return;
      const time = fraction * duration;
      tooltip.textContent = formatTime(time);
      tooltip.style.left = `${clamp(fraction * 100, 0, 100)}%`;
    }

    // Mouse events on the container (the full 24px hit area)
    let dragging = false;

    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      container.classList.add('igpb-dragging');

      const fraction = getSeekFraction(e.clientX);
      seekTo(fraction);

      // Pause while scrubbing (optional — matches YouTube behaviour)
      // video.pause();
    });

    container.addEventListener('mousemove', (e) => {
      const fraction = getSeekFraction(e.clientX);
      updateTooltip(fraction);
      if (dragging) {
        seekTo(fraction);
      }
    });

    container.addEventListener('mouseleave', () => {
      if (!dragging) {
        // Reset tooltip position to current time on leave
        const duration = video.duration;
        if (duration && isFinite(duration)) {
          tooltip.textContent = formatTime(video.currentTime);
        }
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        e.preventDefault();
        const fraction = getSeekFraction(e.clientX);
        seekTo(fraction);
      }
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        container.classList.remove('igpb-dragging');
        // video.play();  // Resume if we paused during scrub
      }
    });

    // Touch support
    container.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      container.classList.add('igpb-dragging');
      const fraction = getSeekFraction(e.touches[0].clientX);
      seekTo(fraction);
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (dragging) {
        const fraction = getSeekFraction(e.touches[0].clientX);
        seekTo(fraction);
        updateTooltip(fraction);
      }
    }, { passive: false });

    container.addEventListener('touchend', () => {
      dragging = false;
      container.classList.remove('igpb-dragging');
    });

    // Prevent clicks on the bar from triggering IG's own play/pause
    container.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // ── 找出目前最活躍的影片（正在播放且可見度最高）──────────────────────────

  function findActiveVideo() {
    const videos = [...document.querySelectorAll(`video[${ATTR}]`)];
    if (!videos.length) return null;

    const playing = videos.filter(v => !v.paused && !v.ended);
    const candidates = playing.length ? playing : videos;

    let best = null;
    let bestArea = -1;
    for (const v of candidates) {
      const rect = v.getBoundingClientRect();
      const visW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const area = visW * visH;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best;
  }

  // ── 靜音提示浮層 ────────────────────────────────────────────────────────

  function showMuteToast(video, muted) {
    const wrapper = video.closest('.igpb-wrapper');
    if (!wrapper) return;

    // 移除已存在的 toast
    wrapper.querySelector('.igpb-mute-toast')?.remove();

    const toast = document.createElement('div');
    toast.className = 'igpb-mute-toast';
    toast.textContent = muted ? '靜音' : '取消靜音';
    wrapper.appendChild(toast);

    // 短暫顯示後淡出
    requestAnimationFrame(() => {
      toast.classList.add('igpb-mute-toast-show');
      setTimeout(() => {
        toast.classList.remove('igpb-mute-toast-show');
        setTimeout(() => toast.remove(), 200);
      }, 800);
    });
  }

  // ── 快捷鍵：M 鍵切換靜音 ─────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // 輸入欄位中不觸發
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

    if (e.key.toLowerCase() === 'm') {
      const video = findActiveVideo();
      if (!video) return;

      const nowMuted = !video.muted;
      video.muted = nowMuted;
      if (!nowMuted) {
        video.removeAttribute('muted');
        if (video.volume === 0) video.volume = 1;
        syncNativeMuteButton(video);
      }

      showMuteToast(video, nowMuted);
      e.preventDefault();
    }
  });

  // ── Scan page for videos ─────────────────────────────────────────────────

  function scanVideos() {
    document.querySelectorAll('video').forEach((video) => {
      // Only attach to videos that have a duration (i.e., not live/story previews that are too short)
      // We attach regardless and let the bar be a no-op on 0-duration videos
      attachProgressBar(video);
    });
  }

  // ── MutationObserver: watch for dynamically added videos ─────────────────

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO') {
          attachProgressBar(node);
        } else {
          node.querySelectorAll?.('video').forEach(attachProgressBar);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan
  scanVideos();

  // Re-scan on navigation (Instagram is a SPA)
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(scanVideos, 800);
    }
  }, 500);
})();
