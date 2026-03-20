import { useMemo } from 'react';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { ApiClient } from '../services/api_client';

export function useApi(): ApiClient {
  const { services } = useKibana<CoreStart>();
  return useMemo(() => new ApiClient(services.http), [services.http]);
}
