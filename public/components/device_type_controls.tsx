/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import React from 'react';
import { css } from '@emotion/react';
import { EuiBadge, EuiFlexGroup, EuiFlexItem, useEuiTheme } from '@elastic/eui';
import { DEVICE_TYPE_CONFIG } from '../../common';

interface DeviceTypeControlsProps {
  hiddenTypes: Set<string>;
  toggleType: (type: string) => void;
}

interface DeviceTypeBadgeProps extends DeviceTypeControlsProps {
  type: string;
}

const DeviceTypeBadge: React.FC<DeviceTypeBadgeProps> = ({ hiddenTypes, toggleType, type }) => {
  const { euiTheme } = useEuiTheme();

  const hidden = hiddenTypes.has(type);
  const color =
    type === 'discovered' ? euiTheme.colors.backgroundLightText : DEVICE_TYPE_CONFIG[type]?.color;

  return (
    <EuiFlexItem grow={false} key={type}>
      <EuiBadge
        color={hidden ? 'default' : color}
        onClick={() => toggleType(type)}
        onClickAriaLabel={`Toggle ${type} node visibility`}
        css={css`
          opacity: ${hidden ? 0.45 : 1};
          transition: opacity 0.15s;
        `}
      >
        {type}
      </EuiBadge>
    </EuiFlexItem>
  );
};

export const DeviceTypeControls: React.FC<DeviceTypeControlsProps> = ({
  hiddenTypes,
  toggleType,
}) => {
  return (
    <EuiFlexItem grow={false}>
      <EuiFlexGroup gutterSize="xs" alignItems="center">
        {[...Object.keys(DEVICE_TYPE_CONFIG), 'discovered'].map((type) => (
          <DeviceTypeBadge
            key={type}
            type={type}
            hiddenTypes={hiddenTypes}
            toggleType={toggleType}
          />
        ))}
      </EuiFlexGroup>
    </EuiFlexItem>
  );
};
