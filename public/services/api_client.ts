import type { HttpSetup } from '@kbn/core/public';
import { API_ROUTES } from '../../common';
import type {
  SitesResponse, TopologyResponse, DevicesResponse, DeviceDetailResponse,
} from '../../common';

export class ApiClient {
  constructor(private http: HttpSetup) {}

  async fetchSites(timeRange = 'now-15m'): Promise<SitesResponse> {
    return this.http.get(API_ROUTES.SITES, { query: { timeRange } });
  }

  async fetchTopology(params: {
    site?: string; building?: string; role?: string; timeRange?: string;
  }): Promise<TopologyResponse> {
    return this.http.get(API_ROUTES.TOPOLOGY, {
      query: { timeRange: 'now-30m', ...params },
    });
  }

  async fetchDevices(params: {
    site?: string; page?: number; pageSize?: number; search?: string;
  }): Promise<DevicesResponse> {
    return this.http.get(API_ROUTES.DEVICES, {
      query: { timeRange: 'now-15m', page: 0, pageSize: 50, sortField: 'host.name', sortOrder: 'asc', ...params },
    });
  }

  async fetchDeviceDetail(deviceId: string): Promise<DeviceDetailResponse> {
    return this.http.get(`${API_ROUTES.DEVICE_DETAIL}/${encodeURIComponent(deviceId)}`, {
      query: { timeRange: 'now-1h' },
    });
  }
}
