/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { memo, useState } from 'react';
import {
  Handle,
  Position,
  useStore as useReactFlowStore,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHealth,
  EuiIcon,
  EuiText,
  EuiTextColor,
  EuiTextTruncate,
  EuiTitle,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import { css, keyframes } from '@emotion/react';
import { DEVICE_TYPE_CONFIG, STATUS_EUI_COLORS } from '../../common';
import type { TopologyNodeData } from '../utils/graph_to_react_flow';

const NODE_SIZE = 60;

// Pulses scale + opacity for down/degraded nodes.
// Compositor-only properties (transform + opacity) — no layout or paint triggered.
// Gated by [data-animations='on'] on the graph container so toggling never
// causes per-node React re-renders; only the container attribute changes.
const nodePulse = keyframes`
  0%   { transform: scale(1);    opacity: 0.85; }
  50%  { transform: scale(1.06); opacity: 1; }
  100% { transform: scale(1);    opacity: 0.85; }
`;

type TopologyDeviceNode = Node<TopologyNodeData, 'device'>;

export const TopologyReactFlowNode = memo(
  ({ data, selected, sourcePosition, targetPosition, dragging }: NodeProps<TopologyDeviceNode>) => {
    const { euiTheme } = useEuiTheme();

    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    // Tracks the same triggers that show the EuiToolTip (hover or keyboard
    // focus on the hit-target below), so the label darkens exactly when the
    // tooltip preview is visible.
    const previewVisible = hovered || focused;

    const unmanaged = data.managed === false;
    // Suppress selected UI when multiple nodes are selected — the flyout only opens for single
    // selections, so showing the ring on multi-select would be misleading.
    const multipleNodesSelected = useReactFlowStore(
      (s) => s.nodes.filter((n) => n.selected).length > 1
    );
    const isSelected = selected && !unmanaged && !multipleNodesSelected;
    const cfg = DEVICE_TYPE_CONFIG[data.type] ?? DEVICE_TYPE_CONFIG.unknown;
    const iconType = unmanaged ? 'question' : cfg.icon;
    const isUnhealthy = data.status === 'down' || data.status === 'degraded';

    // Device fills stay as fixed brand hues (legible in both light/dark; see plan for rationale).
    const fillColor = unmanaged ? euiTheme.colors.backgroundLightText : cfg.color;
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
    // Unmanaged nodes always get a dashed border
    const borderStyle = unmanaged ? 'dashed' : 'solid';
    const borderWidth = isSelected ? 4 : 3;
    const borderColor = isSelected ? euiTheme.colors.primary : statusBorderColor;

    // Outer halo ring uses the node's type color (fixed — this is the "identity" of the device).
    // 8-digit hex suffix = ~50% alpha
    const boxShadow = isSelected ? `0 0 0 4px ${cfg.color}80` : 'none';

    const ariaLabel = `${data.type} device: ${data.label}, status: ${data.status}${
      unmanaged && data.discovery ? `, unmanaged (${data.discovery.toUpperCase()}-discovered)` : ''
    }`;

    const tooltipContent = (
      <EuiFlexGroup direction="column" gutterSize="s">
        <EuiFlexItem>
          <EuiDescriptionList
            type="column"
            compressed
            listItems={[
              {
                title: <EuiTextColor color="ghost">Status</EuiTextColor>,
                description: (
                  <EuiHealth color={STATUS_EUI_COLORS[data.status] ?? 'subdued'}>
                    {data.status}
                  </EuiHealth>
                ),
              },
              {
                title: <EuiTextColor color="ghost">IP</EuiTextColor>,
                description: data.ip || '—',
              },
              {
                title: <EuiTextColor color="ghost">Type</EuiTextColor>,
                description: data.type,
              },
            ]}
          />
        </EuiFlexItem>
        {unmanaged && data.discovery && (
          <EuiFlexItem>
            <EuiText size="xs" color="subdued">
              Unmanaged ({data.discovery.toUpperCase()}-discovered)
            </EuiText>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
    );

    const cursor = dragging ? 'grabbing' : unmanaged ? 'inherit' : 'pointer';

    const wrapperStyles = css`
      cursor: ${cursor};
    `;

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
      cursor: ${cursor};
      pointer-events: all;
      flex-shrink: 0;
      transform-origin: center;
      ${isUnhealthy
        ? css`
            [data-animations='on'] & {
              animation: ${nodePulse} 2s ease-in-out infinite;
            }
          `
        : ''}
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

    const nodeBody = (
      <EuiFlexGroup direction="column" alignItems="center" gutterSize="xs" responsive={false}>
        <EuiFlexItem grow={false}>
          <Handle
            type="source"
            position={sourcePosition ?? Position.Top}
            css={handleStyles}
            isConnectable={false}
          />
          <div
            css={circleStyles}
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-pressed={isSelected}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            <EuiIcon type={iconType} color={iconColor} size="l" aria-hidden={true} />
          </div>
        </EuiFlexItem>
        <EuiFlexItem grow={false} aria-hidden="true">
          <EuiTextTruncate text={data.label} width={120}>
            {(truncatedLabel) => (
              <EuiTitle size="xs">
                <p css={labelStyles}>
                  <EuiTextColor color={selected || previewVisible ? 'default' : 'subdued'}>
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

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        css={wrapperStyles}
      >
        {dragging ? (
          nodeBody
        ) : (
          <EuiToolTip
            title={data.label}
            content={tooltipContent}
            position="right"
            disableScreenReaderOutput
          >
            {nodeBody}
          </EuiToolTip>
        )}
      </div>
    );
  }
);

TopologyReactFlowNode.displayName = 'TopologyReactFlowNode';
