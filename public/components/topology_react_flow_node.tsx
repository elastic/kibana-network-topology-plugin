/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { memo, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiText,
  EuiTextColor,
  EuiTextTruncate,
  EuiTitle,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/react';
import { DEVICE_TYPE_CONFIG } from '../../common';
import type { TopologyNodeData } from '../utils/graph_to_react_flow';

const NODE_SIZE = 60; // diameter in px

type TopologyDeviceNode = Node<TopologyNodeData, 'device'>;

export const TopologyReactFlowNode = memo(
  ({ data, selected, sourcePosition, targetPosition }: NodeProps<TopologyDeviceNode>) => {
    const { euiTheme } = useEuiTheme();

    const [hovered, setHovered] = useState(false);

    const unmanaged = data.managed === false;
    const cfg = DEVICE_TYPE_CONFIG[data.type] ?? DEVICE_TYPE_CONFIG.unknown;
    const iconType = unmanaged ? 'question' : cfg.icon;

    // Device fills stay as fixed brand hues (legible in both light/dark; see plan for rationale).
    // Unmanaged nodes use euiTheme.colors.backgroundBaseSubdued so they read as "muted/discovered" in any mode.
    const fillColor = unmanaged ? euiTheme.colors.backgroundBaseSubdued : cfg.color;
    const iconColor = unmanaged ? euiTheme.colors.textSubdued : euiTheme.colors.plainLight;

    // Status border resolves to euiTheme semantic tokens so it adapts to light/dark.
    // 'unknown' maps to textSubdued (there is no colors.subdued key in EUI).
    const statusBorderColor =
      (
        {
          up: euiTheme.colors.success,
          down: euiTheme.colors.danger,
          degraded: euiTheme.colors.warning,
          unknown: euiTheme.colors.textSubdued,
        } as Record<string, string>
      )[data.status] ?? euiTheme.colors.textSubdued;

    // Border: primary ring when selected (idiomatic EUI selection), status color otherwise.
    // Unmanaged nodes always get a dashed border (canvas parity: setLineDash([4,3])).
    const borderStyle = unmanaged ? 'dashed' : 'solid';
    const borderWidth = selected ? 4 : 3;
    const borderColor = selected ? euiTheme.colors.primary : statusBorderColor;

    // Outer halo ring uses the node's type color (fixed — this is the "identity" of the device).
    // 8-digit hex suffix = ~50% alpha (matches the canvas overlay halo at alpha 0.5).
    const boxShadow = selected ? `0 0 0 4px ${cfg.color}80` : 'none';

    const ariaLabel = `${data.type} device: ${data.label}, status: ${data.status}${
      unmanaged ? ', unmanaged' : ''
    }`;

    const handleStyles = css`
      visibility: hidden;
    `;

    const circleStyles = css`
      width: ${NODE_SIZE}px;
      height: ${NODE_SIZE}px;
      border-radius: 50%;
      background: ${fillColor};
      opacity: ${unmanaged ? 0.7 : 1};
      border: ${borderWidth}px ${borderStyle} ${borderColor};
      box-shadow: ${boxShadow};
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: ${unmanaged ? 'default' : 'pointer'};
      pointer-events: all;
      flex-shrink: 0;
    `;

    const labelStyles = css`
      text-align: center;
      pointer-events: none;
    `;

    const ipStyles = css`
      font-family: ${euiTheme.font.familyCode};
      color: ${euiTheme.colors.textDisabled};
      pointer-events: none;
    `;

    return (
      <EuiFlexGroup direction="column" alignItems="center" gutterSize="xs" responsive={false}>
        <EuiFlexItem grow={false}>
          <Handle
            type="target"
            position={targetPosition ?? Position.Top}
            css={handleStyles}
            isConnectable={false}
          />
          <div
            css={circleStyles}
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-pressed={selected}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <EuiIcon type={iconType} color={iconColor} size="l" aria-hidden={true} />
          </div>
          <Handle
            type="source"
            position={sourcePosition ?? Position.Bottom}
            css={handleStyles}
            isConnectable={false}
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false} aria-hidden="true">
          <EuiTextTruncate text={data.label} width={120}>
            {(truncatedLabel) => (
              <EuiTitle size="xs">
                <p css={labelStyles}>
                  <EuiTextColor color={selected || hovered ? 'default' : 'subdued'}>
                    {truncatedLabel}
                  </EuiTextColor>
                </p>
              </EuiTitle>
            )}
          </EuiTextTruncate>
        </EuiFlexItem>
        {data.ip && (
          <EuiFlexItem grow={false} aria-hidden="true">
            <EuiTextTruncate text={data.ip} width={120}>
              {(truncatedIp) => (
                <EuiText size="xs" textAlign="center">
                  <p css={ipStyles}>{truncatedIp}</p>
                </EuiText>
              )}
            </EuiTextTruncate>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
    );
  }
);

TopologyReactFlowNode.displayName = 'TopologyReactFlowNode';
