import { sliceLoadingState } from './sliceLoadingState.mjs';
import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { Enums, getEnabledElement } from '@cornerstonejs/core';

function ViewportImageSliceLoadingIndicator({ viewportData, element }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState<any>(null);

  useEffect(() => {
    const refresh = () => {
      const viewport = getEnabledElement(element)?.viewport;
      const image = viewport?.getCornerstoneImage?.();
      setProgress(image?.niftiLoadingProgress?.() || null);
      setLoading(sliceLoadingState(viewport).loading);
    };
    refresh();
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [element, viewportData]);

  const loadIndicatorRef = useRef(null);
  const imageIdToBeLoaded = useRef(null);

  const updateLoadingState = () => {
    clearTimeout(loadIndicatorRef.current);
    const viewport = getEnabledElement(element)?.viewport;
    const state = sliceLoadingState(viewport);
    imageIdToBeLoaded.current = state.target;
    setError(false);
    setLoading(state.loading);
  };
  const setLoadingState = updateLoadingState;
  const setFinishLoadingState = updateLoadingState;

  const setErrorState = evt => {
    clearTimeout(loadIndicatorRef.current);

    if (imageIdToBeLoaded.current === evt.detail.imageId) {
      setError(evt.detail.error);
      imageIdToBeLoaded.current = null;
    }
  };

  useEffect(() => {
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, setLoadingState);
    element.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, setErrorState);
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, setFinishLoadingState);

    return () => {
      clearTimeout(loadIndicatorRef.current);
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, setLoadingState);

      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, setFinishLoadingState);

      element.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, setErrorState);
    };
  }, [element, viewportData]);

  const percent = progress?.total ? Math.floor(progress.loaded * 100 / progress.total) : 0;
  const prefetch = progress?.prefetchCases > 0 && ({
    loading: `后续 ${progress.prefetchCases} 例 · 预加载中`,
    complete: `后续 ${progress.prefetchCases} 例 · 已预加载`,
    capacity: '后续预加载 · 缓存已满',
    unavailable: '后续预加载 · 缓存不可用',
    failed: '后续预加载 · 暂不可用',
  })[progress.prefetchState];

  return (
    <>
      {(error || loading) && (
        <div aria-label="当前层正在加载"
          className="pointer-events-none absolute top-0 left-0 flex h-full w-full items-center justify-center bg-black/50">
          <div className="text-primary-light text-center text-xl font-light">
            {error ? <><h4>Error Loading Image</h4><p>{String(error)}</p></> : 'Loading...'}
          </div>
        </div>
      )}
      {progress && (
        <section
          aria-label="图像加载进度"
          className="pointer-events-none absolute overlay-bottom text-center"
          style={{ left: '22%', right: '22%', fontSize: 12, lineHeight: '18px', color: '#9ccef9',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '1px 1px #000' }}
          title={prefetch || undefined}
        >
          <span>{percent === 100 ? '图像已加载' : '图像加载'} {progress.loaded}/{progress.total} 层 · {percent}%</span>
          {progress.failed > 0 && <span className="text-yellow-300"> · {progress.failed} 层加载失败</span>}
          {prefetch && <span> · {prefetch}</span>}
        </section>
      )}
    </>
  );
}

ViewportImageSliceLoadingIndicator.propTypes = {
  error: PropTypes.object,
  element: PropTypes.object,
};

export default ViewportImageSliceLoadingIndicator;
