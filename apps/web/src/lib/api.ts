import axios from 'axios';
import { useAuthStore } from '@web/stores/authStore';

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

const subscribeTokenRefresh = (cb: (token: string) => void): void => {
  refreshSubscribers.push(cb);
};

const onRefreshed = (token: string): void => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((token) => {
          if (axios.isAxiosError(error) && error.config) {
            error.config.headers['Authorization'] = `Bearer ${token}`;
            resolve(axios(error.config));
          }
        });
      });
    }

    isRefreshing = true;

    try {
      const { data } = await axios.post<{ accessToken: string }>('/api/v1/auth/refresh', null, {
        withCredentials: true,
      });
      useAuthStore.getState().setAccessToken(data.accessToken);
      onRefreshed(data.accessToken);

      if (axios.isAxiosError(error) && error.config) {
        error.config.headers['Authorization'] = `Bearer ${data.accessToken}`;
        return axios(error.config);
      }
    } catch {
      useAuthStore.getState().clearAuth();
    } finally {
      isRefreshing = false;
    }

    return Promise.reject(error);
  }
);

export default api;
