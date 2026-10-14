import React from 'react';
import { Button, Tooltip, TooltipTrigger, TooltipContent } from '@ohif/ui-next';
import { Loader2 } from 'lucide-react';

export default function ToolbarIconButton({
  label,
  icon: Icon,
  disabled = false,
  onClick,
  expanded,
  controls,
  badge = 0,
}) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <span className="nt-icon-wrap">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            aria-expanded={expanded}
            aria-controls={controls}
            className="nt-icon h-10 w-10"
          >
            <Icon
              size={23}
              className={Icon === Loader2 ? 'animate-spin' : undefined}
            />
            {badge > 0 && (
              <span
                className="nt-badge"
                aria-hidden="true"
              >
                {badge}
              </span>
            )}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
