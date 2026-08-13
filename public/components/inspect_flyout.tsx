/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useState } from 'react';
import {
  EuiButtonEmpty,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTitle,
} from '@elastic/eui';

export interface InspectTab {
  id: string;
  name: string;
  /**
   * The data to display as formatted JSON. `null` means the data is still
   * loading — a spinner is shown in the tab label and the content area.
   */
  content: object | null;
}

interface Props {
  /** Short description shown below the "Inspect" heading, e.g. "Connections — source.ip → destination.ip" */
  title: string;
  tabs: InspectTab[];
  onClose: () => void;
}

export const InspectFlyout: React.FC<Props> = ({ title, tabs, onClose }) => {
  const [selectedId, setSelectedId] = useState(tabs[0]?.id ?? '');

  const selected = tabs.find((t) => t.id === selectedId) ?? tabs[0];

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus aria-label="Inspect panel">
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2>Inspect</h2>
        </EuiTitle>
        <EuiText size="s" color="subdued">
          <p>{title}</p>
        </EuiText>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        <EuiTabs>
          {tabs.map((tab) => (
            <EuiTab
              key={tab.id}
              isSelected={tab.id === selectedId}
              onClick={() => setSelectedId(tab.id)}
            >
              <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>{tab.name}</EuiFlexItem>
                {tab.content === null && (
                  <EuiFlexItem grow={false}>
                    <EuiLoadingSpinner size="s" />
                  </EuiFlexItem>
                )}
              </EuiFlexGroup>
            </EuiTab>
          ))}
        </EuiTabs>

        <EuiSpacer size="m" />

        {selected?.content === null ? (
          <EuiFlexGroup justifyContent="center" style={{ paddingTop: 40 }}>
            <EuiFlexItem grow={false}>
              <EuiLoadingSpinner size="xl" />
            </EuiFlexItem>
          </EuiFlexGroup>
        ) : (
          <EuiCodeBlock
            language="json"
            fontSize="s"
            isCopyable
            overflowHeight={560}
            paddingSize="m"
          >
            {JSON.stringify(selected?.content, null, 2)}
          </EuiCodeBlock>
        )}
      </EuiFlyoutBody>

      <EuiFlyoutFooter>
        <EuiButtonEmpty iconType="cross" onClick={onClose} flush="left">
          Close
        </EuiButtonEmpty>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};
