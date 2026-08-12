/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  EuiButtonIcon,
  EuiFlexGroup,
  EuiPanel,
  EuiToolTip,
  useEuiTheme,
  type CommonProps,
} from '@elastic/eui';
import { css } from '@emotion/react';
import { useReactFlow, useStore, type ReactFlowState } from '@xyflow/react';

// Icons and control order mirror Kibana's other React Flow map (the Security
// solution's cloud-security-posture graph) so the map reads the same wherever
// an operator meets one. "Reset layout" is additional — it is specific to this
// map, which lets operators drag devices into a custom arrangement.
const ZOOM_IN_ICON = 'plusInCircle';
const ZOOM_OUT_ICON = 'minusInCircle';
const FIT_VIEW_ICON = 'continuityWithin';
const RESET_LAYOUT_ICON = 'refresh';

// Disable the zoom buttons once the viewport is clamped, rather than leaving
// them clickable no-ops.
const zoomLimitSelector = (s: ReactFlowState) => ({
  minZoomReached: s.transform[2] <= s.minZoom,
  maxZoomReached: s.transform[2] >= s.maxZoom,
});

interface Props extends CommonProps {
  /** Clears drag overrides and re-runs the layout algorithm. */
  onResetLayout: () => void;
}

export const TopologyMapControls: React.FC<Props> = ({ onResetLayout, ...rest }) => {
  const { euiTheme } = useEuiTheme();
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { minZoomReached, maxZoomReached } = useStore(zoomLimitSelector);

  const panelStyles = css`
    z-index: ${euiTheme.levels.content};

    @media (max-width: 960px) {
      margin: ${euiTheme.size.xxs} !important;
      overflow: auto;
    }
  `;

  const buttonStyles = css`
    min-inline-size: calc(${euiTheme.size.base} * 2);
    min-block-size: calc(${euiTheme.size.base} * 2);
  `;

  return (
    <EuiPanel
      hasBorder
      hasShadow={false}
      paddingSize="none"
      borderRadius="m"
      grow={false}
      data-test-subj="topologyMapControls"
      css={panelStyles}
      {...rest}
    >
      <EuiFlexGroup
        direction="column"
        gutterSize="none"
        alignItems="center"
        justifyContent="center"
        responsive={false}
      >
        <EuiToolTip content="Zoom in" disableScreenReaderOutput>
          <EuiButtonIcon
            display="empty"
            color="text"
            size="s"
            iconType={ZOOM_IN_ICON}
            onClick={() => zoomIn()}
            disabled={maxZoomReached}
            aria-label="Zoom in"
            data-test-subj="topologyMapZoomIn"
            css={buttonStyles}
          />
        </EuiToolTip>
        <EuiToolTip content="Zoom out" disableScreenReaderOutput>
          <EuiButtonIcon
            display="empty"
            color="text"
            size="s"
            iconType={ZOOM_OUT_ICON}
            onClick={() => zoomOut()}
            disabled={minZoomReached}
            aria-label="Zoom out"
            data-test-subj="topologyMapZoomOut"
            css={buttonStyles}
          />
        </EuiToolTip>
        <EuiToolTip content="Fit view" disableScreenReaderOutput>
          <EuiButtonIcon
            display="empty"
            color="text"
            size="s"
            iconType={FIT_VIEW_ICON}
            onClick={() => fitView()}
            aria-label="Fit view"
            data-test-subj="topologyMapFitView"
            css={buttonStyles}
          />
        </EuiToolTip>
        <EuiToolTip content="Reset layout" disableScreenReaderOutput>
          <EuiButtonIcon
            display="empty"
            color="text"
            size="s"
            iconType={RESET_LAYOUT_ICON}
            onClick={onResetLayout}
            aria-label="Reset layout"
            data-test-subj="topologyMapResetLayout"
            css={buttonStyles}
          />
        </EuiToolTip>
      </EuiFlexGroup>
    </EuiPanel>
  );
};
