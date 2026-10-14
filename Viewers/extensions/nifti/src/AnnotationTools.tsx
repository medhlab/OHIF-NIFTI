import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSystem, useToolbar } from '@ohif/core';
import {
  Button,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  ToolButton,
  ToolSettings,
  ToolButtonList,
  ToolButtonListDefault,
  ToolButtonListDivider,
  ToolButtonListDropDown,
  ToolButtonListItem,
} from '@ohif/ui-next';
import { eventTarget } from '@cornerstonejs/core';
import { Enums } from '@cornerstonejs/tools';
import {
  Sparkles,
  Paintbrush,
  Lock,
  LockOpen,
  Plus,
  Minus,
  Zap,
  Loader2,
  Settings2,
} from 'lucide-react';
import { toolboxState } from '../../default/src/stores/toolboxState';
import './annotation-tools.css';
import { activeAnatomyReadOnly } from './readonly';

const labels = {
  Probe2: '点提示',
  PlanarFreehandROI2: '涂鸦',
  PlanarFreehandROI3: '套索',
  RectangleROI2: '框选',
  Brush: '画笔',
  Eraser: '橡皮擦',
  Threshold: '阈值',
  Shapes: '形状',
  nninter: '应用提示',
  resetNninter: '清空提示',
  InterpolateLabelmap: '跨层插值',
  SegmentBidirectional: '长短径',
};
const settingLabels = {
  'Radius (mm)': '半径 · mm',
  Shape: '形状',
  Circle: '圆形',
  Sphere: '球形',
  Rectangle: '矩形',
  Threshold: '阈值',
  Dynamic: '自动',
  Range: '范围',
};

export default function AnnotationTools({
  beforeAI,
  beforeManual,
  enableAI,
  enableEditing,
  editing,
  sourceKey,
  expanded,
  onExpandedChange,
}) {
  const { servicesManager, commandsManager } = useSystem();
  const { uiNotificationService } = servicesManager.services;
  const anatomyReadOnly = activeAnatomyReadOnly(servicesManager);
  const promptState = commandsManager.run('getNnPromptState') || {
    prompts: [],
    undoCount: 0,
    redoCount: 0,
  };
  const managePrompt = (action, uid?) => {
    if (locked || anatomyReadOnly) return;
    Promise.resolve(commandsManager.run('manageNnPrompts', { action, uid })).catch(error =>
      uiNotificationService.show({ title: 'AI 提示', message: error.message, type: 'error' })
    );
  };
  const ai = useToolbar({ buttonSection: 'aiToolBoxSection' });
  const primary = useToolbar({ buttonSection: 'primary' });
  const brush = useToolbar({ buttonSection: 'brushToolsSection' });
  const manual = useToolbar({ buttonSection: 'segmentationToolboxToolsSection' });
  const utilities = useToolbar({ buttonSection: 'segmentationToolboxUtilitySection' });
  const [mode, setMode] = useState(enableEditing ? 'manual' : 'ai');
  const collapsed = !expanded;
  const setCollapsed = value =>
    onExpandedChange(!(typeof value === 'function' ? value(collapsed) : value));
  const bodyId = `annotation-tools-${sourceKey || 'pending'}`;
  const [, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const locked = toolboxState.getLocked(),
    negative = toolboxState.getPosNeg(),
    live = toolboxState.getLiveMode();
  const hasPendingPrompts = promptState.prompts.some(p => !p.applied && !p.archived);
  const aiTools = ai.toolbarButtons.filter(b =>
    ['Probe2', 'PlanarFreehandROI2', 'PlanarFreehandROI3', 'RectangleROI2'].includes(b.id)
  );
  const manualTools = [
    ...brush.toolbarButtons,
    ...manual.toolbarButtons.filter(b => b.id === 'Shapes'),
  ];
  const activeOptions = (mode === 'ai' ? aiTools : manualTools)
    .find(b => b.componentProps.isActive)?.componentProps.options;
  const change = fn => {
    fn();
    refresh(v => v + 1);
  };
  useEffect(() => {
    const activated = event => {
      const name = event.detail.toolName;
      if (['Probe2', 'RectangleROI2', 'PlanarFreehandROI2', 'PlanarFreehandROI3'].includes(name))
        setMode('ai');
      else if (/Brush|Eraser|Scissors/.test(name)) setMode('manual');
      sequence.current++;
      setPending(false);
    };
    eventTarget.addEventListener(Enums.Events.TOOL_ACTIVATED, activated);
    const timer = setInterval(() => refresh(v => v + 1), 250);
    return () => {
      eventTarget.removeEventListener(Enums.Events.TOOL_ACTIVATED, activated);
      clearInterval(timer);
      sequence.current++;
    };
  }, [sourceKey]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        mode !== 'ai' ||
        locked ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')
      )
        return;
      if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        change(() => toolboxState.setLiveMode(!toolboxState.getLiveMode()));
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        change(() => toolboxState.setPosNeg(!toolboxState.getPosNeg()));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mode, locked]);
  const browse = () => {
    sequence.current++;
    setPending(false);
    primary.onInteraction({ itemId: 'Pan' });
  };
  const activate = async (id, nextMode = mode) => {
    const token = ++sequence.current;
    const button = [...ai.toolbarButtons, ...manualTools, ...utilities.toolbarButtons].find(
      b => b.id === id
    );
    if (
      !editing ||
      promptState.busy ||
      activeAnatomyReadOnly(servicesManager) ||
      !button ||
      (nextMode === 'ai' && (button.componentProps.disabled || locked || promptState.busy))
    )
      return;
    if ([...aiTools, ...manualTools].some(b => b.id === id) && button.componentProps.isActive) {
      return; // Selecting the same tool keeps it active; Browse is explicit.
    }
    setPending(true);
    try {
      if (nextMode === 'ai') await beforeAI?.();
      else await beforeManual?.();
      if (token !== sequence.current) return;
      if (nextMode === 'ai') toolboxState.setSelectedModel('nnInteractive');
      setMode(nextMode);
      // The shared toolbar dispatch applies current options and mutually
      // excludes the prior primary mouse tool; no separate editor tool state.
      ai.onInteraction({ itemId: id });
    } catch (error) {
      if (token === sequence.current)
        uiNotificationService.show({ title: '标注工具', message: error.message, type: 'error' });
    } finally {
      if (token === sequence.current) setPending(false);
    }
  };
  const selectMode = next => {
    if (next === mode || pending || promptState.busy) return;
    if (editing) {
      void activate(next === 'ai' ? 'Probe2' : 'Brush', next);
    } else {
      setMode(next);
    }
  };
  const toolProps = (tool, nextMode) => ({
    ...tool.componentProps,
    id: tool.id,
    label: tool.id === 'nninter' && promptState.error ? '重试' : labels[tool.id] || tool.componentProps.label,
    tooltip: tool.componentProps.isActive ? '当前工具 · 使用浏览按钮切换' : undefined,
    disabled:
      !editing ||
      anatomyReadOnly ||
      promptState.busy ||
      pending ||
      !sourceKey ||
      (tool.id === 'nninter' && !hasPendingPrompts && !promptState.error) ||
      (nextMode === 'ai'
        ? tool.componentProps.disabled || locked || promptState.busy
        : utilities.toolbarButtons.includes(tool) && tool.componentProps.disabled),
    disabledText: tool.id === 'nninter' && !hasPendingPrompts && !promptState.error
      ? '没有待处理提示'
      : !editing
      ? '请先点击 Entity 的编辑按钮'
      : anatomyReadOnly
        ? '结构辅助图层只读，请选择 Entity 后编辑'
        : locked && nextMode === 'ai'
          ? '请先解锁 AI 提示'
          : promptState.busy
            ? '正在推理，请等待完成后切换工具'
          : pending
            ? '正在准备标注'
            : tool.componentProps.disabledText,
  });
  const renderTool = (tool, nextMode) => (
    <ToolButton
      key={tool.id}
      {...toolProps(tool, nextMode)}
      onInteraction={() => activate(tool.id, nextMode)}
    />
  );
  const renderGroup = (items, nextMode, label) => {
    if (!items.length) return null;
    const selected = items.find(t => t.componentProps.isActive) || items[0];
    return (
      <ToolButtonList aria-label={label}>
        <ToolButtonListDefault>{renderTool(selected, nextMode)}</ToolButtonListDefault>
        <ToolButtonListDivider
          className={selected.componentProps.isActive ? 'opacity-0' : 'opacity-100'}
        />
        <div
          className="nt-tool-dropdown"
          aria-label={label}
        >
          <ToolButtonListDropDown>
            {items.map(tool => (
              <ToolButtonListItem
                key={tool.id}
                {...toolProps(tool, nextMode)}
                data-tool={tool.id}
                onSelect={() => activate(tool.id, nextMode)}
              >
                {labels[tool.id] || tool.componentProps.label}
              </ToolButtonListItem>
            ))}
          </ToolButtonListDropDown>
        </div>
      </ToolButtonList>
    );
  };
  return (
    <section
      className="annotation-tools"
      aria-label="标注工具"
    >
      <div className="at-mode-switch" role="group" aria-label="标注模式">
        {[[ 'manual', Paintbrush, '手工编辑', enableEditing ], [ 'ai', Sparkles, 'AI 提示', enableAI ]].map(([value, Icon, label, enabled]) => enabled && (
          <Tooltip key={value as string} disableHoverableContent>
            <TooltipTrigger asChild>
              <span><Button type="button" variant="ghost" size="icon"
                aria-label={label as string} aria-pressed={mode === value}
                disabled={pending || promptState.busy}
                onClick={() => selectMode(value)} className="at-mode-button h-10 w-10">
                {React.createElement(Icon as React.ElementType, { size: 23 })}
              </Button></span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label as string}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {enableEditing && mode === 'manual' &&
        renderGroup(
          [...manualTools.filter(t => t.id !== 'Eraser'), ...utilities.toolbarButtons],
          'manual',
          '手工标注工具'
        )}
      {enableEditing && mode === 'manual' &&
        manualTools.filter(t => t.id === 'Eraser').map(t => renderTool(t, 'manual'))}
      {enableAI && mode === 'ai' && renderGroup(aiTools, 'ai', 'AI 提示工具')}
      {enableAI && mode === 'ai' && (!live || promptState.error) && ai.toolbarButtons.filter(t => t.id === 'nninter').map(t => renderTool(t, 'ai'))}
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="at-heading h-10 w-10"
              aria-label="标注设置与提示管理"
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              onClick={() => setCollapsed(value => !value)}
            >
              {pending ? (
                <Loader2
                  size={23}
                  className="animate-spin"
                />
              ) : (
                <Settings2 size={23} />
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">标注设置与提示管理</TooltipContent>
      </Tooltip>
      {createPortal(
        <section className="annotation-tools nt-overlay">
          <div
            id={bodyId}
            hidden={collapsed}
            className="at-body nt-popover"
            role="region"
            aria-label="顶部标注工具设置"
          >
            <strong className="at-mode-title">{mode === 'ai' ? 'AI 提示设置' : '手工编辑设置'}</strong>
            <div
              role="tabpanel"
              aria-label={mode === 'ai' ? 'AI 提示工具' : '手工编辑工具'}
            >
              {mode === 'ai' && (
                <div className="at-ai-controls">
                  <div
                    className="at-polarity"
                    aria-label="提示类型"
                  >
                    <button
                      type="button"
                      aria-pressed={!negative}
                      onClick={() => change(() => toolboxState.setPosNeg(false))}
                      title="包含区域 · W"
                    >
                      <Plus size={14} />
                      包含
                    </button>
                    <button
                      type="button"
                      aria-pressed={negative}
                      onClick={() => change(() => toolboxState.setPosNeg(true))}
                      title="排除区域 · W"
                    >
                      <Minus size={14} />
                      排除
                    </button>
                  </div>
                  <button
                    type="button"
                    className="at-live"
                    aria-pressed={live}
                    title="自动推理 · Q"
                    onClick={() => change(() => toolboxState.setLiveMode(!live))}
                  >
                    <Zap size={14} />
                    自动
                  </button>
                  <button
                    type="button"
                    className="at-lock"
                    aria-label={locked ? '解锁 AI 工具' : '锁定 AI 工具'}
                    aria-pressed={locked}
                    onClick={() =>
                      change(() => {
                        sequence.current++;
                        setPending(false);
                        toolboxState.setLocked(!locked);
                        if (!locked) {
                          toolboxState.setLiveMode(false);
                          browse();
                        }
                      })
                    }
                  >
                    {locked ? <Lock size={16} /> : <LockOpen size={16} />}
                  </button>
                </div>
              )}

              {activeOptions && (
                <div className="at-settings">
                  <ToolSettings
                    options={
                      Array.isArray(activeOptions)
                        ? activeOptions.map(option => ({
                            ...option,
                            name: settingLabels[option.name] || option.name,
                            values: option.values?.map(item => ({
                              ...item,
                              label: settingLabels[item.label] || item.label,
                            })),
                          }))
                        : activeOptions
                    }
                  />
                </div>
              )}

              {mode === 'ai' && (
                <section
                  className="at-prompts"
                  aria-label="当前 Entity AI 提示"
                >
                  <div className="at-prompt-heading">
                    <strong>当前 Entity 提示 · {promptState.prompts.length}</strong>
                    <button
                      disabled={!promptState.prompts.length}
                      aria-label={promptState.visible ? '隐藏 AI 提示' : '显示 AI 提示'}
                      onClick={() => managePrompt('visibility')}
                    >
                      {promptState.visible ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <div className="at-prompt-history">
                    <button
                      disabled={locked || anatomyReadOnly || !promptState.undoCount}
                      onClick={() => managePrompt('undo')}
                    >
                      撤销提示
                    </button>
                    <button
                      disabled={locked || anatomyReadOnly || !promptState.redoCount}
                      onClick={() => managePrompt('redo')}
                    >
                      重做提示
                    </button>
                    <button
                      disabled={locked || anatomyReadOnly || !promptState.prompts.length}
                      onClick={() => managePrompt('clear')}
                    >
                      清空当前 Entity 提示
                    </button>
                  </div>
                  {promptState.busy && <p role="status">nnInteractive 正在推理…</p>}
                  {promptState.error && <p role="alert">{promptState.error}，可点击顶部“重试”。</p>}
                  {!promptState.target && <p>请先点击 Entity 的编辑按钮。</p>}
                  {promptState.prompts.map((prompt, index) => (
                    <div
                      key={prompt.uid}
                      className="at-prompt-row"
                      data-prompt-id={prompt.uid}
                    >
                      <button
                        aria-label={`定位提示 ${index + 1}`}
                        onClick={() => managePrompt('locate', prompt.uid)}
                      >
                        {index + 1}. {prompt.negative ? '排除' : '包含'} ·{' '}
                        {labels[prompt.toolName] || '提示'}
                        {prompt.index ? ` · 层 ${Math.round(prompt.index[2]) + 1}` : ''}
                      </button>
                      <small>
                        {prompt.archived ? '已归入人工 mask' : prompt.applied ? '已应用' : '待推理'}
                      </small>
                      <button
                        disabled={locked || anatomyReadOnly}
                        aria-label={`删除提示 ${index + 1}`}
                        onClick={() => managePrompt('delete', prompt.uid)}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  <small>
                    隐藏只改变显示；删除和清空会重算本轮 AI 结果。人工编辑后的 mask 会作为新的基线。
                  </small>
                </section>
              )}
              <footer>
                {mode === 'ai' ? (
                  <>
                    <span className="at-dot" />
                    nnInteractive<span>当前选中目标</span>
                  </>
                ) : (
                  <>
                    <span className="at-dot" />
                    直接编辑 mask<span>球形 / 插值需完整体数据</span>
                  </>
                )}
              </footer>
            </div>
          </div>
        </section>,
        document.body
      )}
    </section>
  );
}
