/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import {
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiTitle,
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiButtonEmpty,
  EuiCopy,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import type { ConnectionsGraph, ConnectionsNode } from '../../common';
import { CONNECTION_ROLE_COLORS } from '../../common';
import { formatBytes, formatCount } from '../utils/format';

interface Props {
  node: ConnectionsNode;
  /** Unfiltered graph — peers stay visible even when hidden client-side. */
  graph: ConnectionsGraph;
  srcField: string;
  dstField: string;
  isHidden: boolean;
  isFocused: boolean;
  onClose: () => void;
  onToggleHide: (nodeId: string) => void;
  onToggleFocus: (nodeId: string) => void;
}

interface PeerRow {
  peer: string;
  outbound: boolean;
  sessions: number;
  bytes?: number;
}

export const ConnectionNodeFlyout: React.FC<Props> = ({
  node,
  graph,
  srcField,
  dstField,
  isHidden,
  isFocused,
  onClose,
  onToggleHide,
  onToggleFocus,
}) => {
  // Derived from the link list already in memory — no extra request.
  const peers: PeerRow[] = useMemo(
    () =>
      graph.links
        .filter((l) => l.source === node.id || l.target === node.id)
        .map((l) => ({
          peer: l.source === node.id ? l.target : l.source,
          outbound: l.source === node.id,
          sessions: l.sessions,
          bytes: l.bytes,
        }))
        .sort((a, b) => b.sessions - a.sessions),
    [graph.links, node.id]
  );

  const seenAs =
    node.role === 'both'
      ? `${srcField} and ${dstField}`
      : node.role === 'source'
      ? srcField
      : dstField;

  const details = [
    { title: 'Role', description: node.role },
    { title: 'Seen in', description: seenAs },
    { title: 'Sessions', description: formatCount(node.sessions) },
    { title: 'Peers', description: formatCount(node.degree) },
  ];
  if (node.bytes !== undefined) {
    details.push({ title: 'Bytes', description: formatBytes(node.bytes) });
  }
  if (node.packets !== undefined) {
    details.push({ title: 'Packets', description: formatCount(node.packets) });
  }

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus aria-label={`Connections detail for ${node.id}`}>
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiBadge color={CONNECTION_ROLE_COLORS[node.role] ?? CONNECTION_ROLE_COLORS.both}>
              {node.role}
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiTitle size="m">
              <h2 style={{ fontFamily: 'monospace' }}>{node.id}</h2>
            </EuiTitle>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiDescriptionList type="inline" compressed listItems={details} />
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        <EuiTitle size="xs">
          <h3>Top peers ({peers.length})</h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiBasicTable
          items={peers}
          compressed
          tableLayout="auto"
          columns={[
            {
              field: 'outbound',
              name: 'Direction',
              width: '110px',
              render: (outbound: boolean) => (
                <EuiBadge color="hollow" iconType={outbound ? 'sortRight' : 'sortLeft'}>
                  {outbound ? 'to' : 'from'}
                </EuiBadge>
              ),
            },
            {
              field: 'peer',
              name: 'Peer',
              render: (peer: string) => (
                <EuiText size="s" style={{ fontFamily: 'monospace' }}>
                  {peer}
                </EuiText>
              ),
            },
            {
              field: 'sessions',
              name: 'Sessions',
              width: '110px',
              render: (sessions: number) => formatCount(sessions),
            },
            {
              field: 'bytes',
              name: 'Bytes',
              width: '110px',
              render: (bytes: number | undefined) => formatBytes(bytes),
            },
          ]}
        />
      </EuiFlyoutBody>

      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty iconType="cross" onClick={onClose} flush="left">
              Close
            </EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiCopy textToCopy={node.id}>
                  {(copy) => (
                    <EuiButtonEmpty iconType="copyClipboard" onClick={copy}>
                      Copy value
                    </EuiButtonEmpty>
                  )}
                </EuiCopy>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty
                  iconType={isHidden ? 'eye' : 'eyeClosed'}
                  onClick={() => onToggleHide(node.id)}
                >
                  {isHidden ? 'Show node' : 'Hide node'}
                </EuiButtonEmpty>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton
                  size="s"
                  fill={!isFocused}
                  iconType={isFocused ? 'expand' : 'crosshairs'}
                  onClick={() => onToggleFocus(node.id)}
                >
                  {isFocused ? 'Clear focus' : 'Focus'}
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};
