import type { HttpSetup } from '@kbn/core/public';
import { API_ROUTES } from '../../common';
import type {
  SitesResponse, SegmentsResponse, TopologyResponse, DevicesResponse, DeviceDetailResponse, SetupHealthResponse,
} from '../../common';

export class ApiClient {
  constructor(private http: HttpSetup) {}

  async fetchSites(params: { from?: string; to?: string } = {}): Promise<SitesResponse> {
    return this.http.get(API_ROUTES.SITES, { query: { from: 'now-15m', to: 'now', ...params } });
  }

  async fetchSegments(params: { from?: string; to?: string; site?: string } = {}): Promise<SegmentsResponse> {
    return this.http.get(API_ROUTES.SEGMENTS, { query: { from: 'now-15m', to: 'now', ...params } });
  }

  async fetchTopology(params: {
    site?: string; building?: string; role?: string; cidr?: string; from?: string; to?: string;
  }): Promise<TopologyResponse> {
    return this.http.get(API_ROUTES.TOPOLOGY, {
      query: { from: 'now-30m', to: 'now', ...params },
    });
  }

  async fetchDevices(params: {
    site?: string; page?: number; pageSize?: number; kql?: string; filters?: string; from?: string; to?: string;
  }): Promise<DevicesResponse> {
    return this.http.get(API_ROUTES.DEVICES, {
      query: { from: 'now-15m', to: 'now', page: 0, pageSize: 50, sortField: 'host.name', sortOrder: 'asc', ...params },
    });
  }

  async fetchDeviceDetail(deviceId: string, params: { from?: string; to?: string } = {}): Promise<DeviceDetailResponse> {
    return this.http.get(`${API_ROUTES.DEVICE_DETAIL}/${encodeURIComponent(deviceId)}`, {
      query: { from: 'now-1h', to: 'now', ...params },
    });
  }

  async checkSetupHealth(): Promise<SetupHealthResponse> {
    return this.http.get(API_ROUTES.SETUP_HEALTH);
  }
}
