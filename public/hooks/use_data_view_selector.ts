/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useEffect, useState, useCallback } from 'react';
import type { DataView, DataViewListItem } from '@kbn/data-views-plugin/public';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { useKibana } from '@kbn/kibana-react-plugin/public';

type KibanaServices = CoreStart & { data: DataPublicPluginStart };

export function useDataViewSelector() {
  const { services } = useKibana<KibanaServices>();
  const dataViews = services.data.dataViews;

  const [savedDataViews, setSavedDataViews] = useState<DataViewListItem[]>([]);
  const [selectedDataView, setSelectedDataView] = useState<DataView | undefined>();

  // Load the list of all saved data views and resolve the default selection on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [listItems, defaultDv] = await Promise.all([
        dataViews.getIdsWithTitle(),
        dataViews.getDefaultDataView({ displayErrors: false }).catch(() => null),
      ]);

      if (cancelled) return;
      setSavedDataViews(listItems);
      if (defaultDv) setSelectedDataView(defaultDv);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [dataViews]);

  // Called by the DataViewPicker when the user selects a different data view
  const onChangeDataView = useCallback(
    async (newId: string) => {
      const dv = await dataViews.get(newId);
      setSelectedDataView(dv);
    },
    [dataViews]
  );

  return { selectedDataView, savedDataViews, onChangeDataView };
}
